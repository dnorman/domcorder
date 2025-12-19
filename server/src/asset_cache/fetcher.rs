//! Server-side asset fetcher for CORS-blocked assets

use crate::asset_cache::{AssetError, AssetFileStore, MetadataStore, store_or_get_asset_metadata};
use crate::asset_cache::hash::sha256;
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
    info!("🌐 Fetching asset from URL: {}", url);

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

    // Fetch the asset
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| AssetError::Storage(Box::new(e)))?;

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
        .map_err(|e| AssetError::Storage(Box::new(e)))?
        .to_vec();

    debug!("Fetched {} bytes from {}", data.len(), url);

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

