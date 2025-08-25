pub mod server;
pub mod storage;

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

#[derive(Debug)]
pub struct StorageState {
    pub storage_dir: std::path::PathBuf,
    // Track which recordings are currently being written to
    pub active_recordings: Mutex<HashMap<String, DateTime<Utc>>>,
}

#[cfg(test)]
mod server_test;
