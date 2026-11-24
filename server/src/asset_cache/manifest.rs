//! Cache manifest generation and management

use crate::asset_cache::{AssetError, ManifestEntry, MetadataStore};
use crate::logged_url::LoggedUrl;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

/// Cache manifest sent to the recorder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheManifest {
    /// List of cached assets (URL + SHA-256 hash)
    pub assets: Vec<ManifestEntry>,
    /// The site origin this manifest is for
    pub site_origin: String,
}

/// Default limit for manifest entries
const DEFAULT_MANIFEST_LIMIT: usize = 200;

/// Generate a cache manifest for a site
pub async fn generate_manifest(
    metadata_store: &dyn MetadataStore,
    site_origin: &str,
    limit: Option<usize>,
) -> Result<CacheManifest, AssetError> {
    let limit = limit.unwrap_or(DEFAULT_MANIFEST_LIMIT);
    
    info!("Generating cache manifest for site: {} (limit: {})", LoggedUrl(site_origin), limit);
    
    let assets = metadata_store.get_site_manifest(site_origin, limit).await?;
    
    debug!("Generated manifest with {} entries for {}", assets.len(), LoggedUrl(site_origin));
    
    Ok(CacheManifest {
        assets,
        site_origin: site_origin.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::generate_manifest;
    use crate::asset_cache::sqlite::SqliteMetadataStore;
    use crate::captured_logs::CapturedLogs;

    #[tokio::test]
    async fn the_manifest_lines_show_the_sites_origin_without_its_user_info_query_or_fragment() {
        let temp_dir = tempfile::tempdir().unwrap();
        let store = SqliteMetadataStore::new(temp_dir.path().join("test.db")).unwrap();
        let (logs, _capturing) = CapturedLogs::start();

        generate_manifest(&store, "https://person:SECRET@example.com/?q=SECRET#SECRET", None)
            .await
            .unwrap();

        logs.assert_shows("Generating cache manifest for site: https://example.com/ (limit: 200)");
        logs.assert_shows("Generated manifest for https://example.com/ with 0 entries");
        logs.assert_shows("Generated manifest with 0 entries for https://example.com/");
        logs.assert_never_shows("SECRET");
    }
}
