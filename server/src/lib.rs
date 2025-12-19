pub mod asset_cache;
pub mod recording_handler;
pub mod server;
pub mod storage;

// Re-export commonly used types
pub use asset_cache::{AssetFileStore, MetadataStore};
pub use recording_handler::{handle_websocket_recording, RecordingConfig, RecordingHooks};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingInfo {
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub created: DateTime<Utc>,
    pub is_active: bool, // Whether the recording is still being written to
}

pub type AppState = std::sync::Arc<StorageState>;

pub struct StorageState {
    pub storage_dir: std::path::PathBuf,
    // Track which recordings are currently being written to
    pub active_recordings: Mutex<HashMap<String, DateTime<Utc>>>,
    // Asset caching stores
    pub metadata_store: Box<dyn MetadataStore>,
    pub asset_file_store: Box<dyn AssetFileStore>,
}

impl std::fmt::Debug for StorageState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StorageState")
            .field("storage_dir", &self.storage_dir)
            .field("active_recordings", &self.active_recordings)
            .field("metadata_store", &"<dyn MetadataStore>")
            .field("asset_file_store", &"<dyn AssetFileStore>")
            .finish()
    }
}

#[cfg(test)]
mod server_test;
