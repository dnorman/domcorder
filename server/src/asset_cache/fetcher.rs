//! Server-side asset fetcher for CORS-blocked assets

use crate::asset_cache::{AssetError, AssetFileStore, MetadataStore, store_or_get_asset_metadata};
use crate::asset_cache::hash::sha256;
use crate::logged_url::LoggedUrl;
use reqwest::Client;
use std::time::Duration;
use tracing::{debug, info};

/// Fetch an asset from a URL and store it in the cache
/// Returns (sha256_hash, random_id)
pub async fn fetch_and_cache_asset(
    url: &str,
    user_agent: Option<&str>,
    metadata_store: &dyn MetadataStore,
    asset_file_store: &dyn AssetFileStore,
) -> Result<(String, String), AssetError> {
    info!("🌐 Fetching asset from URL: {}", LoggedUrl(url));

    // Create HTTP client with timeout
    let mut client_builder = Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5));

    // Add User-Agent if provided (to avoid bot detection)
    if let Some(ua) = user_agent {
        client_builder = client_builder.user_agent(ua);
    }

    let client = client_builder.build()
        .map_err(|e| AssetError::Storage(Box::new(e)))?;

    // Fetch the asset. A client's error can carry the address it failed on, so each error loses
    // it here, and the lines that print the error name the asset in its logged form.
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AssetError::Storage(Box::new(e.without_url())))?;

    if !response.status().is_success() {
        return Err(AssetError::Storage(Box::new(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("HTTP error: {}", response.status()),
        ))));
    }

    // Get MIME type from response
    let mime_type = response
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();

    // Read the asset data
    let data = response
        .bytes()
        .await
        .map_err(|e| AssetError::Storage(Box::new(e.without_url())))?
        .to_vec();

    debug!("Fetched {} bytes from {}", data.len(), LoggedUrl(url));

    // Compute SHA-256 hash (for storage and manifest)
    let sha256_hash = sha256(&data);

    // Store asset and get/ensure random_id exists
    let random_id = store_or_get_asset_metadata(
        &sha256_hash,
        &data,
        &mime_type,
        metadata_store,
        asset_file_store,
    ).await?;

    Ok((sha256_hash, random_id))
}

#[cfg(test)]
mod tests {
    use super::fetch_and_cache_asset;
    use crate::asset_cache::AssetError;
    use crate::asset_cache::local::LocalBinaryStore;
    use crate::asset_cache::sqlite::SqliteMetadataStore;
    use crate::captured_logs::CapturedLogs;
    use tempfile::TempDir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// An asset's address on a local `port`, with user info, a query and a fragment.
    fn asset_address(port: u16) -> String {
        format!("http://person:SECRET@127.0.0.1:{port}/asset.txt?token=SECRET#SECRET")
    }

    /// The two stores a fetch caches its asset in, kept in `dir`.
    fn stores(dir: &TempDir) -> (SqliteMetadataStore, LocalBinaryStore) {
        (
            SqliteMetadataStore::new(dir.path().join("asset_cache.db")).unwrap(),
            LocalBinaryStore::new(dir.path().join("assets"), "http://test.example".to_string())
                .unwrap(),
        )
    }

    /// Answers one request on a local port with `answer` and closes the connection, and returns
    /// the port.
    async fn answering_once(answer: &'static [u8]) -> u16 {
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = server.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut connection, _) = server.accept().await.unwrap();
            // Read the request before answering it
            let mut request = [0u8; 4096];
            let read = connection.read(&mut request).await.unwrap();
            assert!(read > 0, "the fetch sent no request");
            connection.write_all(answer).await.unwrap();
        });
        port
    }

    #[tokio::test]
    async fn a_fetch_logs_the_assets_address_without_its_user_info_query_or_fragment() {
        let port = answering_once(
            b"HTTP/1.1 200 OK\r\ncontent-length: 5\r\nconnection: close\r\n\r\nasset",
        )
        .await;
        let dir = tempfile::tempdir().unwrap();
        let (metadata_store, asset_file_store) = stores(&dir);
        let (logs, _capturing) = CapturedLogs::start();

        fetch_and_cache_asset(&asset_address(port), None, &metadata_store, &asset_file_store)
            .await
            .unwrap();

        logs.assert_shows(&format!("Fetching asset from URL: http://127.0.0.1:{port}/asset.txt"));
        logs.assert_shows(&format!("Fetched 5 bytes from http://127.0.0.1:{port}/asset.txt"));
        logs.assert_never_shows("SECRET");
    }

    #[tokio::test]
    async fn a_refused_fetchs_error_holds_no_part_of_the_address() {
        let refusing = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = refusing.local_addr().unwrap().port();
        drop(refusing);
        let dir = tempfile::tempdir().unwrap();
        let (metadata_store, asset_file_store) = stores(&dir);

        let error =
            fetch_and_cache_asset(&asset_address(port), None, &metadata_store, &asset_file_store)
                .await
                .unwrap_err()
                .to_string();

        assert!(
            !error.contains("SECRET") && !error.contains("127.0.0.1"),
            "the error shows the address: {error}"
        );
    }

    #[tokio::test]
    async fn a_fetch_whose_body_ends_early_fails_with_an_error_that_holds_no_part_of_the_address() {
        // The answer promises ten bytes of body and closes after five
        let port = answering_once(b"HTTP/1.1 200 OK\r\ncontent-length: 10\r\n\r\nasset").await;
        let dir = tempfile::tempdir().unwrap();
        let (metadata_store, asset_file_store) = stores(&dir);

        let error =
            fetch_and_cache_asset(&asset_address(port), None, &metadata_store, &asset_file_store)
                .await
                .unwrap_err();

        let AssetError::Storage(source) = &error else {
            panic!("the fetch failed otherwise: {error}");
        };
        let fetch_error = source
            .downcast_ref::<reqwest::Error>()
            .expect("the fetch failed otherwise");
        assert!(
            fetch_error.is_body() || fetch_error.is_decode(),
            "the fetch failed before its body: {error}"
        );
        let error = error.to_string();
        assert!(
            !error.contains("SECRET") && !error.contains("127.0.0.1"),
            "the error shows the address: {error}"
        );
    }
}
