//! Cache manifest generation and management

use crate::asset_cache::{AssetError, ManifestEntry, MetadataStore};
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
    
    info!("Generating cache manifest for site: {} (limit: {})", site_origin, limit);
    
    let assets = metadata_store.get_site_manifest(site_origin, limit).await?;
    
    debug!("Generated manifest with {} entries for {}", assets.len(), site_origin);
    
    Ok(CacheManifest {
        assets,
        site_origin: site_origin.to_string(),
    })
}

