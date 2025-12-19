//! Asset caching system for Domcorder
//!
//! This module provides abstractions for storing and retrieving assets
//! in a content-addressable store, with metadata tracking for efficient
//! cache-aware recording.

pub mod fetcher;
pub mod hash;
pub mod local;
pub mod manifest;
pub mod playback;
pub mod sqlite;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

/// Error type for asset caching operations
#[derive(Error, Debug)]
pub enum AssetError {
    #[error("Storage error: {0}")]
    Storage(#[from] Box<dyn std::error::Error + Send + Sync + 'static>),
    
    #[error("Database error: {0}")]
    Database(String),
    
    #[error("Hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    
    #[error("Asset not found: {0}")]
    NotFound(String),
    
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<rusqlite::Error> for AssetError {
    fn from(e: rusqlite::Error) -> Self {
        AssetError::Database(e.to_string())
    }
}

/// Site information extracted from a recording's initial URL
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteInfo {
    /// The normalized origin (scheme + host + port)
    pub origin: String,
    /// The full initial URL
    pub initial_url: String,
}

/// A single entry in a cache manifest sent to the recorder
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestEntry {
    /// The asset URL
    pub url: String,
    /// The SHA-256 hash (manifest hash) for this asset
    pub sha256_hash: String,
}

/// Parameters for registering asset usage on a site
#[derive(Debug, Clone)]
pub struct AssetUsageParams {
    /// The site origin
    pub site_origin: String,
    /// The asset URL
    pub url: String,
    /// The SHA-256 hash (manifest hash)
    pub sha256_hash: String,
    /// The asset size in bytes
    pub size: u64,
}

/// Metadata for an asset stored in the CAS
#[derive(Debug, Clone)]
pub struct AssetMetadata {
    /// The SHA-256 hash (storage key and manifest hash) - primary identifier
    pub sha256_hash: String,
    /// The random ID (retrieval token) - used for HTTP endpoint
    pub random_id: String,
    /// The asset size in bytes
    pub size: u64,
    /// The MIME type
    pub mime_type: String,
}

/// Trait for managing asset metadata and site profiles
///
/// This abstraction allows for different storage backends (SQLite, Postgres, etc.)
/// while maintaining a consistent interface for asset tracking.
#[async_trait::async_trait]
pub trait MetadataStore: Send + Sync {
    /// Register the start of a recording and extract site information
    ///
    /// Returns the normalized site origin and stores the recording metadata.
    async fn register_recording(
        &self,
        recording_id: &str,
        initial_url: &str,
    ) -> Result<SiteInfo, AssetError>;

    /// Generate a prioritized manifest for a site
    ///
    /// Returns up to `limit` entries, ordered by usage frequency and size.
    async fn get_site_manifest(
        &self,
        site_origin: &str,
        limit: usize,
    ) -> Result<Vec<ManifestEntry>, AssetError>;

    /// Resolve a SHA-256 (manifest) hash to its random_id (retrieval token)
    ///
    /// Returns `None` if the hash is not known.
    async fn resolve_hashes(&self, sha256: &str) -> Result<Option<String>, AssetError>;
    
    /// Resolve a random_id (retrieval token) to its SHA-256 (storage key)
    ///
    /// Returns `None` if the random_id is not known.
    async fn resolve_random_id(&self, random_id: &str) -> Result<Option<String>, AssetError>;

    /// Register that an asset was used on a site
    ///
    /// Updates usage statistics (frequency, last_seen) for manifest prioritization.
    async fn register_asset_usage(&self, params: AssetUsageParams) -> Result<(), AssetError>;

    /// Store asset metadata linking SHA-256 to random_id
    ///
    /// This is called after an asset has been successfully stored in the AssetFileStore.
    async fn store_asset_metadata(&self, metadata: AssetMetadata) -> Result<(), AssetError>;

    /// Get asset metadata by random_id
    ///
    /// Returns the MIME type and size if the asset exists.
    async fn get_asset_metadata(&self, random_id: &str) -> Result<Option<(String, u64)>, AssetError>;
    
    /// Get the MIME type for an asset by random_id
    async fn get_asset_mime_type(&self, random_id: &str) -> Result<Option<String>, AssetError>;
}

/// Trait for physical storage of asset binary data
///
/// This abstraction allows for different storage backends (local filesystem, S3, etc.)
/// while maintaining a consistent interface for asset storage and URL resolution.
#[async_trait::async_trait]
pub trait AssetFileStore: Send + Sync {
    /// Store binary asset data
    ///
    /// The data is stored using the SHA-256 hash as the identifier (for CAS).
    /// This operation should be atomic: either the asset is fully stored or not at all.
    async fn put(&self, hash: &str, data: &[u8], mime: &str) -> Result<(), AssetError>;

    /// Check if an asset exists in the store
    async fn exists(&self, hash: &str) -> Result<bool, AssetError>;

    /// Resolve a hash to a URL that the player can fetch
    ///
    /// This allows for late-binding of URLs:
    /// - Local storage: returns `/assets/{hash}`
    /// - S3 storage: returns a CDN URL or pre-signed URL
    async fn resolve_url(&self, hash: &str) -> Result<String, AssetError>;

    /// Read asset data from the store
    ///
    /// Returns the asset bytes if the asset exists.
    async fn get(&self, hash: &str) -> Result<Vec<u8>, AssetError>;

    /// Get the storage type identifier (e.g., "local", "s3")
    fn storage_type(&self) -> &str;

    /// Get the JSON configuration for this storage backend
    ///
    /// This configuration will be sent to the client in the PlaybackConfig frame.
    /// The configuration should include any URLs or settings needed for the client
    /// to resolve asset hashes to HTTP URLs.
    fn config_json(&self) -> Result<String, AssetError>;
}

/// Store an asset and ensure it has metadata with a random_id
///
/// This function handles the common logic of:
/// - Checking if asset exists in CAS
/// - Resolving SHA-256 to random_id if it exists
/// - Storing the asset if it's new
/// - Ensuring metadata exists (handles edge case where asset exists but metadata doesn't)
///
/// Returns the random_id for the asset.
pub async fn store_or_get_asset_metadata(
    sha256_hash: &str,
    data: &[u8],
    mime_type: &str,
    metadata_store: &dyn MetadataStore,
    asset_file_store: &dyn AssetFileStore,
) -> Result<String, AssetError> {
    // Check if asset already exists (by SHA-256)
    let exists = asset_file_store.exists(sha256_hash).await?;
    
    if exists {
        // Asset exists in CAS - try to resolve SHA-256 to random_id
        match metadata_store.resolve_hashes(sha256_hash).await {
            Ok(Some(existing_random_id)) => {
                debug!("♻️  Asset already cached: sha256={}, random_id={}", 
                       &sha256_hash[..16], &existing_random_id[..16]);
                return Ok(existing_random_id);
            }
            Ok(None) => {
                // Asset exists in CAS but not in metadata - create metadata entry
                warn!("⚠️  Asset exists in CAS but not in metadata, creating metadata entry");
                let new_random_id = hash::generate_random_id();
                let metadata = AssetMetadata {
                    sha256_hash: sha256_hash.to_string(),
                    random_id: new_random_id.clone(),
                    size: data.len() as u64,
                    mime_type: mime_type.to_string(),
                };
                metadata_store.store_asset_metadata(metadata).await?;
                return Ok(new_random_id);
            }
            Err(e) => {
                // Error resolving - try to recover by creating metadata entry
                warn!("Failed to resolve existing asset (sha256={}): {}, creating metadata entry", 
                      &sha256_hash[..16], e);
                let new_random_id = hash::generate_random_id();
                let metadata = AssetMetadata {
                    sha256_hash: sha256_hash.to_string(),
                    random_id: new_random_id.clone(),
                    size: data.len() as u64,
                    mime_type: mime_type.to_string(),
                };
                // If storing metadata fails, return the error
                metadata_store.store_asset_metadata(metadata).await?;
                return Ok(new_random_id);
            }
        }
    }
    
    // Asset doesn't exist in CAS - check if metadata exists (inconsistent state)
    // Try to resolve to see if metadata exists without CAS entry
    if let Ok(Some(existing_random_id)) = metadata_store.resolve_hashes(sha256_hash).await {
        error!("❌ Inconsistent state: metadata exists (random_id={}) but asset not in CAS (sha256={}). Storing asset to fix inconsistency.", 
               &existing_random_id[..16], &sha256_hash[..16]);
        
        // Store the asset in CAS (using SHA-256 as key)
        asset_file_store.put(sha256_hash, data, mime_type).await?;
        info!("💾 Restored asset to CAS: sha256={}, random_id={} ({} bytes)", 
              &sha256_hash[..16], &existing_random_id[..16], data.len());
        
        // Update metadata with correct size (in case it was wrong)
        let metadata = AssetMetadata {
            sha256_hash: sha256_hash.to_string(),
            random_id: existing_random_id.clone(),
            size: data.len() as u64,
            mime_type: mime_type.to_string(),
        };
        metadata_store.store_asset_metadata(metadata).await?;
        
        return Ok(existing_random_id);
    }
    
    // New asset - store it and generate random_id
    let random_id = hash::generate_random_id();
    
    // Store the asset in CAS (using SHA-256 as key)
    asset_file_store.put(sha256_hash, data, mime_type).await?;
    debug!("💾 Stored new asset: sha256={}, random_id={} ({} bytes)", 
          &sha256_hash[..16], &random_id[..16], data.len());
    
    // Store metadata linking SHA-256 to random_id
    let metadata = AssetMetadata {
        sha256_hash: sha256_hash.to_string(),
        random_id: random_id.clone(),
        size: data.len() as u64,
        mime_type: mime_type.to_string(),
    };
    metadata_store.store_asset_metadata(metadata).await?;
    
    Ok(random_id)
}

