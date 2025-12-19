//! Playback frame transformation for asset caching
//!
//! This module handles converting AssetReference frames to HTTP URLs
//! during playback, enabling browser caching.

use crate::asset_cache::{AssetError, AssetFileStore, MetadataStore};
use domcorder_proto::Frame;
use tracing::debug;

/// Transform frames during playback to use HTTP URLs for cached assets
pub struct PlaybackFrameTransformer {
    metadata_store: Box<dyn MetadataStore>,
    asset_file_store: Box<dyn AssetFileStore>,
    base_url: String,
}

impl PlaybackFrameTransformer {
    pub fn new(
        metadata_store: Box<dyn MetadataStore>,
        asset_file_store: Box<dyn AssetFileStore>,
        base_url: String,
    ) -> Self {
        Self {
            metadata_store,
            asset_file_store,
            base_url,
        }
    }

    /// Transform a frame for playback
    ///
    /// - AssetReference frames: hash field contains random_id, resolve to HTTP URL
    /// - Asset frames: Convert to AssetReference with HTTP URL (if cached)
    /// - Other frames: Pass through unchanged
    pub async fn transform_frame(&self, frame: Frame) -> Result<Frame, AssetError> {
        match frame {
            Frame::AssetReference(asset_ref) => {
                // hash field contains random_id (from recording stream)
                // Resolve random_id to HTTP URL
                let url = self.asset_file_store.resolve_url(&asset_ref.hash).await?;
                let full_url = if url.starts_with("http://") || url.starts_with("https://") {
                    url
                } else {
                    format!("{}{}", self.base_url, url)
                };
                
                debug!("Resolved AssetReference to URL: {}", full_url);
                
                // Return Asset frame with URL instead of binary data
                // The player will fetch from HTTP instead of using blob URL
                Ok(Frame::Asset(domcorder_proto::AssetData {
                    asset_id: asset_ref.asset_id,
                    url: full_url,
                    mime: asset_ref.mime,
                    buf: Vec::new(), // Empty - player will fetch from URL
                    fetch_error: domcorder_proto::AssetFetchError::None,
                }))
            }
            Frame::Asset(asset) => {
                // For Asset frames with binary data, check if we can convert to HTTP URL
                // This allows old recordings to benefit from HTTP caching
                if !asset.buf.is_empty() {
                    // Compute SHA-256 hash to check if asset is cached
                    let sha256_hash = crate::asset_cache::hash::sha256(&asset.buf);
                    
                    // Check if asset exists in cache (by SHA-256)
                    if self.asset_file_store.exists(&sha256_hash).await? {
                        // Resolve SHA-256 to random_id, then to HTTP URL
                        match self.metadata_store.resolve_hashes(&sha256_hash).await? {
                            Some(random_id) => {
                                let url = self.asset_file_store.resolve_url(&random_id).await?;
                                let full_url = if url.starts_with("http://") || url.starts_with("https://") {
                                    url
                                } else {
                                    format!("{}{}", self.base_url, url)
                                };
                                
                                debug!("Converted Asset to HTTP URL: {}", full_url);
                                
                                // Return Asset frame with URL instead of binary
                                Ok(Frame::Asset(domcorder_proto::AssetData {
                                    asset_id: asset.asset_id,
                                    url: full_url,
                                    mime: asset.mime,
                                    buf: Vec::new(), // Empty - player will fetch from URL
                                    fetch_error: domcorder_proto::AssetFetchError::None,
                                }))
                            }
                            None => {
                                // Asset not in metadata, return original with binary data
                                Ok(Frame::Asset(asset))
                            }
                        }
                    } else {
                        // Asset not cached, return original with binary data
                        Ok(Frame::Asset(asset))
                    }
                } else {
                    // Already has URL, pass through
                    Ok(Frame::Asset(asset))
                }
            }
            other => Ok(other),
        }
    }
}

