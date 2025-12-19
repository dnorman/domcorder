//! SQLite implementation of the MetadataStore trait

use crate::asset_cache::{AssetError, AssetMetadata, AssetUsageParams, ManifestEntry, MetadataStore, SiteInfo};
use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::{debug, info};

/// SQLite-backed implementation of MetadataStore
pub struct SqliteMetadataStore {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteMetadataStore {
    /// Create a new SQLite metadata store
    ///
    /// If the database doesn't exist, it will be created with the required schema.
    pub fn new<P: AsRef<Path>>(db_path: P) -> Result<Self, AssetError> {
        let conn = Connection::open(db_path)?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        store.init_schema()?;
        Ok(store)
    }

    /// Initialize the database schema
    fn init_schema(&self) -> Result<(), AssetError> {
        let conn = self.conn.lock().unwrap();
        
        // Assets table: maps SHA-256 (storage key) to random_id (retrieval token)
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS assets (
                sha256_hash TEXT PRIMARY KEY,
                random_id TEXT NOT NULL UNIQUE,
                size INTEGER NOT NULL,
                mime_type TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#,
            [],
        )?;

        // Index on random_id for fast retrieval lookups
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_random_id ON assets(random_id)",
            [],
        )?;

        // Site assets table: tracks which assets are used on which sites
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS site_assets (
                site_origin TEXT NOT NULL,
                url TEXT NOT NULL,
                sha256_hash TEXT NOT NULL,
                usage_count INTEGER NOT NULL DEFAULT 1,
                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (site_origin, url, sha256_hash)
            )
            "#,
            [],
        )?;

        // Index for manifest generation queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_site_assets_origin ON site_assets(site_origin, usage_count DESC)",
            [],
        )?;

        // URL versions table: tracks all versions of URLs across all sites
        // This enables version detection and stability analysis
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS url_versions (
                url TEXT NOT NULL,
                sha256_hash TEXT NOT NULL,
                first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (url, sha256_hash)
            )
            "#,
            [],
        )?;

        // Index for URL lookup
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_url_versions_url ON url_versions(url, last_seen_at DESC)",
            [],
        )?;

        // Recordings table: tracks recording metadata
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS recordings (
                recording_id TEXT PRIMARY KEY,
                site_origin TEXT NOT NULL,
                initial_url TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#,
            [],
        )?;

        info!("Asset cache database schema initialized");
        Ok(())
    }

    /// Extract the origin from a URL
    fn extract_origin(url: &str) -> Result<String, AssetError> {
        url::Url::parse(url)
            .map_err(|e| AssetError::InvalidUrl(format!("Failed to parse URL: {}", e)))
            .map(|parsed| {
                let scheme = parsed.scheme();
                let host = parsed.host_str().unwrap_or("");
                let port = parsed.port();
                if let Some(port) = port {
                    format!("{}://{}:{}", scheme, host, port)
                } else {
                    format!("{}://{}", scheme, host)
                }
            })
    }
}

#[async_trait::async_trait]
impl MetadataStore for SqliteMetadataStore {
    async fn register_recording(
        &self,
        recording_id: &str,
        initial_url: &str,
    ) -> Result<SiteInfo, AssetError> {
        let origin = Self::extract_origin(initial_url)?;
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT OR REPLACE INTO recordings (recording_id, site_origin, initial_url) VALUES (?1, ?2, ?3)",
            params![recording_id, origin, initial_url],
        )?;

        Ok(SiteInfo {
            origin,
            initial_url: initial_url.to_string(),
        })
    }

    async fn get_site_manifest(
        &self,
        site_origin: &str,
        limit: usize,
    ) -> Result<Vec<ManifestEntry>, AssetError> {
        let conn = self.conn.lock().unwrap();
        
        // Query assets for this site, ordered by usage_count and size
        // We join with assets table to get the size for sorting
        let mut stmt = conn.prepare(
            r#"
            SELECT sa.url, sa.sha256_hash, a.size
            FROM site_assets sa
            JOIN assets a ON sa.sha256_hash = a.sha256_hash
            WHERE sa.site_origin = ?1
            ORDER BY sa.usage_count DESC, a.size DESC
            LIMIT ?2
            "#,
        )?;

        let entries: Vec<ManifestEntry> = stmt
            .query_map(params![site_origin, limit as i64], |row| {
                Ok(ManifestEntry {
                    url: row.get(0)?,
                    sha256_hash: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        debug!("Generated manifest for {} with {} entries", site_origin, entries.len());
        Ok(entries)
    }

    async fn resolve_hashes(&self, sha256: &str) -> Result<Option<String>, AssetError> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare("SELECT random_id FROM assets WHERE sha256_hash = ?1")?;
        let mut rows = stmt.query_map(params![sha256], |row| row.get::<_, String>(0))?;
        
        match rows.next() {
            Some(Ok(random_id)) => Ok(Some(random_id)),
            Some(Err(e)) => Err(AssetError::Database(e.to_string())),
            None => Ok(None),
        }
    }
    
    async fn resolve_random_id(&self, random_id: &str) -> Result<Option<String>, AssetError> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare("SELECT sha256_hash FROM assets WHERE random_id = ?1")?;
        let mut rows = stmt.query_map(params![random_id], |row| row.get::<_, String>(0))?;
        
        match rows.next() {
            Some(Ok(sha256)) => Ok(Some(sha256)),
            Some(Err(e)) => Err(AssetError::Database(e.to_string())),
            None => Ok(None),
        }
    }

    async fn register_asset_usage(&self, params: AssetUsageParams) -> Result<(), AssetError> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        
        // Update site-specific asset usage
        conn.execute(
            r#"
            INSERT INTO site_assets (site_origin, url, sha256_hash, usage_count, last_seen_at)
            VALUES (?1, ?2, ?3, 1, ?4)
            ON CONFLICT(site_origin, url, sha256_hash) DO UPDATE SET
                usage_count = usage_count + 1,
                last_seen_at = ?4
            "#,
            params![
                params.site_origin,
                params.url,
                params.sha256_hash,
                now
            ],
        )?;

        // Also track URL version globally (for version detection and stability analysis)
        conn.execute(
            r#"
            INSERT INTO url_versions (url, sha256_hash, first_seen_at, last_seen_at)
            VALUES (?1, ?2, ?3, ?3)
            ON CONFLICT(url, sha256_hash) DO UPDATE SET
                last_seen_at = ?3
            "#,
            params![
                params.url,
                params.sha256_hash,
                now
            ],
        )?;

        Ok(())
    }

    async fn store_asset_metadata(&self, metadata: AssetMetadata) -> Result<(), AssetError> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            r#"
            INSERT OR REPLACE INTO assets (sha256_hash, random_id, size, mime_type, created_at)
            VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
            "#,
            params![
                metadata.sha256_hash,
                metadata.random_id,
                metadata.size as i64,
                metadata.mime_type
            ],
        )?;

        debug!(
            "Stored asset metadata: sha256={}, random_id={}, size={}",
            &metadata.sha256_hash[..16], &metadata.random_id[..16], metadata.size
        );
        Ok(())
    }

    async fn get_asset_metadata(&self, random_id: &str) -> Result<Option<(String, u64)>, AssetError> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare("SELECT mime_type, size FROM assets WHERE random_id = ?1")?;
        let mut rows = stmt.query_map(params![random_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64))
        })?;
        
        match rows.next() {
            Some(Ok(metadata)) => Ok(Some(metadata)),
            Some(Err(e)) => Err(AssetError::Database(e.to_string())),
            None => Ok(None),
        }
    }
    
    async fn get_asset_mime_type(&self, random_id: &str) -> Result<Option<String>, AssetError> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare("SELECT mime_type FROM assets WHERE random_id = ?1")?;
        let mut rows = stmt.query_map(params![random_id], |row| {
            Ok(row.get::<_, String>(0)?)
        })?;
        
        match rows.next() {
            Some(Ok(mime_type)) => Ok(Some(mime_type)),
            Some(Err(e)) => Err(AssetError::Database(e.to_string())),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_register_recording() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let store = SqliteMetadataStore::new(db_path).unwrap();

        let site_info = store
            .register_recording("rec-1", "https://example.com/page")
            .await
            .unwrap();

        assert_eq!(site_info.origin, "https://example.com");
        assert_eq!(site_info.initial_url, "https://example.com/page");
    }

    #[tokio::test]
    async fn test_store_and_resolve_hashes() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let store = SqliteMetadataStore::new(db_path).unwrap();

        let metadata = AssetMetadata {
            sha256_hash: "sha256-hash-456".to_string(),
            random_id: "random-id-123".to_string(),
            size: 1024,
            mime_type: "image/png".to_string(),
        };

        store.store_asset_metadata(metadata).await.unwrap();

        let resolved = store.resolve_hashes("sha256-hash-456").await.unwrap();
        assert_eq!(resolved, Some("random-id-123".to_string()));

        let not_found = store.resolve_hashes("unknown-hash").await.unwrap();
        assert_eq!(not_found, None);
    }
}

