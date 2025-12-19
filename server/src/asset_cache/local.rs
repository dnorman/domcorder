//! Local filesystem implementation of the AssetFileStore trait

use crate::asset_cache::{AssetError, AssetFileStore};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{debug, info};

/// Local filesystem-backed implementation of AssetFileStore
pub struct LocalBinaryStore {
    base_path: PathBuf,
    base_url: String,
}

impl LocalBinaryStore {
    /// Create a new local binary store
    ///
    /// The base_path will be created if it doesn't exist.
    /// The base_url is the server's base URL for serving assets (e.g., "http://127.0.0.1:8723").
    pub fn new<P: AsRef<Path>>(base_path: P, base_url: String) -> Result<Self, AssetError> {
        let base_path = base_path.as_ref().to_path_buf();
        fs::create_dir_all(&base_path)?;
        info!("Initialized LocalBinaryStore at {:?} with base_url={}", base_path, base_url);
        Ok(Self { base_path, base_url })
    }

    /// Get the filesystem path for a given hash
    ///
    /// Uses a nested directory structure: {hash[0:2]}/{hash[2:4]}/{hash[4:]}
    /// Works with SHA-256 (64 hex chars) or any hash string.
    fn hash_to_path(&self, hash: &str) -> PathBuf {
        if hash.len() < 4 {
            // Fallback for short hashes
            return self.base_path.join(hash);
        }

        let dir1 = &hash[0..2];
        let dir2 = &hash[2..4];
        let filename = &hash[4..];

        self.base_path.join(dir1).join(dir2).join(filename)
    }

    /// Store data atomically using a temporary file
    fn put_atomic(&self, hash: &str, data: &[u8]) -> Result<(), AssetError> {
        let final_path = self.hash_to_path(hash);
        
        // Create parent directories
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Write to a temporary file first
        let temp_path = final_path.with_extension(".tmp");
        fs::write(&temp_path, data)?;

        // Atomically move to final location
        fs::rename(&temp_path, &final_path)?;

        debug!("Stored asset {} at {:?}", hash, final_path);
        Ok(())
    }
}

#[async_trait::async_trait]
impl AssetFileStore for LocalBinaryStore {
    async fn put(&self, hash: &str, data: &[u8], _mime: &str) -> Result<(), AssetError> {
        // Use tokio::task::spawn_blocking for filesystem I/O
        let store = self.clone();
        let hash = hash.to_string();
        let data = data.to_vec();

        tokio::task::spawn_blocking(move || store.put_atomic(&hash, &data))
            .await
            .map_err(|e| AssetError::Storage(Box::new(e)))?
    }

    async fn exists(&self, hash: &str) -> Result<bool, AssetError> {
        let path = self.hash_to_path(hash);
        Ok(path.exists())
    }

    async fn resolve_url(&self, hash: &str) -> Result<String, AssetError> {
        // For local storage, return a relative path that the HTTP server can serve
        Ok(format!("/assets/{}", hash))
    }

    async fn get(&self, hash: &str) -> Result<Vec<u8>, AssetError> {
        let path = self.hash_to_path(hash);
        let data = tokio::fs::read(&path).await?;
        Ok(data)
    }

    fn storage_type(&self) -> &str {
        "local"
    }

    fn config_json(&self) -> Result<String, AssetError> {
        Ok(serde_json::json!({
            "base_url": self.base_url
        })
        .to_string())
    }
}

// Clone implementation for LocalBinaryStore (needed for spawn_blocking)
impl Clone for LocalBinaryStore {
    fn clone(&self) -> Self {
        Self {
            base_path: self.base_path.clone(),
            base_url: self.base_url.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_put_and_exists() {
        let temp_dir = TempDir::new().unwrap();
        let store = LocalBinaryStore::new(temp_dir.path(), "http://test.example".to_string()).unwrap();

        let hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
        let data = b"test asset data";

        store.put(hash, data, "text/plain").await.unwrap();

        assert!(store.exists(hash).await.unwrap());
        
        let retrieved = store.get(hash).await.unwrap();
        assert_eq!(retrieved, data);
    }

    #[tokio::test]
    async fn test_resolve_url() {
        let temp_dir = TempDir::new().unwrap();
        let store = LocalBinaryStore::new(temp_dir.path(), "http://test.example".to_string()).unwrap();

        let hash = "test-hash-123";
        let url = store.resolve_url(hash).await.unwrap();

        assert_eq!(url, "/assets/test-hash-123");
    }

    #[tokio::test]
    async fn test_config_json() {
        let temp_dir = TempDir::new().unwrap();
        let base_url = "http://test.example:8080".to_string();
        let store = LocalBinaryStore::new(temp_dir.path(), base_url.clone()).unwrap();

        let config = store.config_json().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&config).unwrap();
        
        assert_eq!(parsed["base_url"], base_url);
    }
}

