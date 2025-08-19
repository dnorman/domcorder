pub mod server;
pub mod storage;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingInfo {
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub created: DateTime<Utc>,
}

pub type AppState = std::sync::Arc<StorageState>;

#[derive(Debug)]
pub struct StorageState {
    pub storage_dir: std::path::PathBuf,
}

#[cfg(test)]
mod server_test;
