use crate::asset_cache::{
    AssetUsageParams, AssetFileStore, MetadataStore,
    store_or_get_asset_metadata,
};
use crate::{RecordingInfo, StorageState};
use chrono::Utc;
use domcorder_proto::{FileHeader, FrameReader, FrameWriter};
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use tokio::io::AsyncRead;
use tokio_stream::StreamExt;
use tracing::{debug, info, warn};
use uuid::Uuid;

impl StorageState {
    pub fn new(
        storage_dir: PathBuf,
        metadata_store: Box<dyn MetadataStore>,
        asset_file_store: Box<dyn AssetFileStore>,
    ) -> Self {
        // Ensure storage directory exists
        fs::create_dir_all(&storage_dir).expect("Failed to create storage directory");
        
        // Ensure recordings subdirectory exists
        let recordings_dir = storage_dir.join("recordings");
        fs::create_dir_all(&recordings_dir).expect("Failed to create recordings directory");

        Self {
            storage_dir,
            active_recordings: std::sync::Mutex::new(std::collections::HashMap::new()),
            metadata_store,
            asset_file_store,
        }
    }
    
    /// Get the recordings directory path
    fn recordings_dir(&self) -> PathBuf {
        self.storage_dir.join("recordings")
    }

    pub fn generate_filename(&self) -> String {
        let timestamp = Utc::now().format("%Y-%m-%d_%H-%M-%S.%f");
        let uuid = Uuid::new_v4().simple();
        format!("{}_{}.dcrr", timestamp, uuid)
    }

    pub fn save_recording(&self, data: &[u8]) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.recordings_dir().join(&filename);

        let mut file = fs::File::create(&filepath)?;
        file.write_all(data)?;
        file.flush()?;

        Ok(filename)
    }

    pub fn list_recordings(&self, subdir: Option<PathBuf>) -> io::Result<Vec<RecordingInfo>> {
        let mut recordings = Vec::new();
        let active_recordings = self.active_recordings.lock().unwrap();

        let read_dir = if let Some(subdir) = subdir {
            fs::read_dir(&self.recordings_dir().join(&subdir))?
        } else {
            fs::read_dir(&self.recordings_dir())?
        };

        for entry in read_dir {
            let entry = entry?;
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) == Some("dcrr") {
                let metadata = fs::metadata(&path)?;
                let created = metadata
                    .created()
                    .map(|t| chrono::DateTime::from(t))
                    .unwrap_or_else(|_| Utc::now());

                let filename = path.file_name().unwrap().to_string_lossy().to_string();
                let is_active = active_recordings.contains_key(&filename);

                recordings.push(RecordingInfo {
                    id: filename.clone(),
                    filename,
                    size: metadata.len(),
                    created,
                    is_active,
                });
            }
        }

        // Sort by creation time, newest first
        recordings.sort_by(|a, b| b.created.cmp(&a.created));

        Ok(recordings)
    }

    pub fn get_recording(&self, filename: &str) -> io::Result<Vec<u8>> {
        let filepath = self.recordings_dir().join(filename);

        if !filepath.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Recording not found",
            ));
        }

        let mut file = fs::File::open(&filepath)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;

        Ok(data)
    }

    pub fn recording_exists(&self, filename: &str) -> bool {
        self.recordings_dir().join(filename).exists()
    }

    /// Mark a recording as active (being written to)
    pub fn mark_recording_active(&self, filename: &str) {
        let mut active_recordings = self.active_recordings.lock().unwrap();
        active_recordings.insert(filename.to_string(), Utc::now());
    }

    /// Mark a recording as completed (no longer being written to)
    pub fn mark_recording_completed(&self, filename: &str) {
        let mut active_recordings = self.active_recordings.lock().unwrap();
        active_recordings.remove(&filename.to_string());
    }

    /// Check if a recording is currently active
    pub fn is_recording_active(&self, filename: &str) -> bool {
        let active_recordings = self.active_recordings.lock().unwrap();
        active_recordings.contains_key(&filename.to_string())
    }

    /// TEMPORARILY BYPASS FRAME PROCESSING: Stream raw data directly to file with header
    pub async fn save_recording_stream_raw<R: AsyncRead + Unpin>(
        &self,
        mut source: R,
        subdir: Option<PathBuf>,
        filename: Option<String>,
    ) -> io::Result<String> {
        let recording_dir = match subdir.clone() {    
            Some(subdir) => self.recordings_dir().join(subdir.clone()),
            None => self.recordings_dir(),
        };

        fs::create_dir_all(&recording_dir)?;


        let file_name = match filename {
            Some(filename) => filename,
            None => self.generate_filename(),
        };

        let recording_file = recording_dir.join(file_name.clone());

        let relative_path = match subdir {
            Some(subdir) => subdir.join(file_name.clone()).to_string_lossy().to_string(),
            None => file_name,
        };

        info!("Saving recording to: {}", relative_path);

        // Mark this recording as active
        self.mark_recording_active(&relative_path);

        // First, write the file header using the sync FrameWriter
        let header = FileHeader::new();
        {
            // Create a temporary sync file handle for header writing
            let sync_file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&recording_file)?;
            let mut frame_writer = FrameWriter::new(sync_file);
            frame_writer.write_header(&header)?;
            frame_writer.flush()?;
        }

        // Reopen the file in append mode for async operations
        let mut output_file = tokio::fs::OpenOptions::new()
            .append(true)
            .open(&recording_file)
            .await?;

        // Copy raw frame bytes directly after the header - no frame processing
        let bytes_copied = tokio::io::copy(&mut source, &mut output_file).await?;

        info!(
            "📁 Raw copy completed: {} bytes written to {} (plus header)",
            bytes_copied, recording_file.to_string_lossy().to_string()
        );

        // Mark this recording as completed
        self.mark_recording_completed(&relative_path);

        Ok(relative_path)
    }

    /// Stream and validate frames from an AsyncRead source (frame data only, no header), writing them to a file
    pub async fn save_recording_stream_frames_only<R: AsyncRead + Unpin>(
        &self,
        source: R,
    ) -> io::Result<String> {
        self.save_recording_stream_frames_only_with_site(source, None, None).await
    }

    /// Stream and validate frames with site context for asset caching
    pub async fn save_recording_stream_frames_only_with_site<R: AsyncRead + Unpin>(
        &self,
        source: R,
        site_origin: Option<&str>,
        user_agent: Option<&str>,
    ) -> io::Result<String> {
        self.save_recording_stream_frames_only_with_site_and_path(source, site_origin, user_agent, None, None).await
    }

    /// Stream and validate frames with site context for asset caching, with custom path/filename
    pub async fn save_recording_stream_frames_only_with_site_and_path<R: AsyncRead + Unpin>(
        &self,
        source: R,
        site_origin: Option<&str>,
        user_agent: Option<&str>,
        subdir: Option<PathBuf>,
        custom_filename: Option<String>,
    ) -> io::Result<String> {
        let recording_dir = match subdir {
            Some(ref subdir) => self.recordings_dir().join(subdir),
            None => self.recordings_dir(),
        };
        
        fs::create_dir_all(&recording_dir)?;
        
        let filename = custom_filename.unwrap_or_else(|| self.generate_filename());
        let filepath = recording_dir.join(&filename);
        
        // For active recording tracking, use relative path if subdir is provided
        let tracking_path = match subdir {
            Some(ref subdir) => subdir.join(&filename).to_string_lossy().to_string(),
            None => filename.clone(),
        };

        // Mark this recording as active
        self.mark_recording_active(&tracking_path);

        // Create the file for writing
        let output_file = fs::File::create(&filepath)?;
        let mut frame_writer = FrameWriter::new(output_file);

        // Create frame reader from the async source (no header expected)
        let mut frame_reader = FrameReader::new(source, false);

        // Create and write a new header with current timestamp
        let header = FileHeader::new();

        if let Err(e) = frame_writer.write_header(&header) {
            let failed_filename = format!("{}.failed", filename);
            let failed_filepath = recording_dir.join(&failed_filename);
            let _ = fs::rename(&filepath, &failed_filepath);
            return Err(e);
        }

        // Stream frames from input to output, validating each one
        while let Some(frame_result) = frame_reader.next().await {
            match frame_result {
                Ok(frame) => {
                    // Process Asset and AssetReference frames
                    let processed_frame = self.filter_frame_async(frame, site_origin, user_agent).await;

                    if let Some(frame) = processed_frame {
                        // Write the validated frame to output
                        if let Err(e) = frame_writer.write_frame(&frame) {
                            let failed_filename = format!("{}.failed", filename);
                            let failed_filepath = recording_dir.join(&failed_filename);
                            let _ = fs::rename(&filepath, &failed_filepath);
                            self.mark_recording_completed(&tracking_path);
                            return Err(e);
                        }
                    }
                    // If filter returned None, skip this frame
                }
                Err(e) => {
                    // Frame parsing failed - mark as failed and return error
                    let failed_filename = format!("{}.failed", filename);
                    let failed_filepath = recording_dir.join(&failed_filename);
                    let _ = fs::rename(&filepath, &failed_filepath);
                    self.mark_recording_completed(&tracking_path);
                    return Err(e);
                }
            }
        }

        // Flush the writer to ensure all data is written
        frame_writer.flush()?;

        // Mark this recording as completed
        self.mark_recording_completed(&tracking_path);

        // Return the tracking path (relative path if subdir was used)
        Ok(tracking_path)
    }

    /// Stream and validate frames from an AsyncRead source, writing them to a file
    pub async fn save_recording_stream<R: AsyncRead + Unpin>(
        &self,
        source: R,
    ) -> io::Result<String> {
        self.save_recording_stream_with_site(source, None, None).await
    }

    /// Stream and validate frames with site context
    pub async fn save_recording_stream_with_site<R: AsyncRead + Unpin>(
        &self,
        source: R,
        site_origin: Option<&str>,
        user_agent: Option<&str>,
    ) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.recordings_dir().join(&filename);

        // Mark this recording as active
        self.mark_recording_active(&filename);

        // Create the file for writing
        let output_file = fs::File::create(&filepath)?;
        let mut frame_writer = FrameWriter::new(output_file);

        // Create frame reader from the async source (expect header)
        let mut frame_reader = FrameReader::new(source, true);

        // Read and validate the header first
        let header = match frame_reader.read_header().await {
            Ok(header) => header,
            Err(e) => {
                // Header validation failed - mark as failed and return error
                let failed_filename = format!("{}.failed", filename);
                let failed_filepath = self.recordings_dir().join(&failed_filename);
                if let Err(_) = fs::rename(&filepath, &failed_filepath) {
                    // If rename fails, try to delete the original file
                    let _ = fs::remove_file(&filepath);
                }
                return Err(e);
            }
        };

        // Write the original header to the output file (preserving timestamp)
        if let Err(e) = frame_writer.write_header(&header) {
            let failed_filename = format!("{}.failed", filename);
            let failed_filepath = self.recordings_dir().join(&failed_filename);
            let _ = fs::rename(&filepath, &failed_filepath);
            return Err(e);
        }

        // Stream frames from input to output, validating each one
        while let Some(frame_result) = frame_reader.next().await {
            match frame_result {
                Ok(frame) => {
                    // Process Asset and AssetReference frames
                    let processed_frame = self.filter_frame_async(frame, site_origin, user_agent).await;

                    if let Some(frame) = processed_frame {
                        // Write the validated frame to output
                        if let Err(e) = frame_writer.write_frame(&frame) {
                            let failed_filename = format!("{}.failed", filename);
                            let failed_filepath = self.recordings_dir().join(&failed_filename);
                            let _ = fs::rename(&filepath, &failed_filepath);
                            self.mark_recording_completed(&filename);
                            return Err(e);
                        }
                    }
                    // If filter returned None, skip this frame
                }
                Err(e) => {
                    // Frame parsing failed - mark as failed and return error
                    let failed_filename = format!("{}.failed", filename);
                    let failed_filepath = self.recordings_dir().join(&failed_filename);
                    let _ = fs::rename(&filepath, &failed_filepath);
                    self.mark_recording_completed(&filename);
                    return Err(e);
                }
            }
        }

        // Flush the writer to ensure all data is written
        frame_writer.flush()?;

        // Mark this recording as completed
        self.mark_recording_completed(&filename);

        Ok(filename)
    }

    /// Get a streaming reader for a recording (supports live tailing for active recordings)
    pub async fn get_recording_stream(
        self: std::sync::Arc<Self>,
        filename: &str,
    ) -> io::Result<Box<dyn tokio::io::AsyncRead + Unpin + Send>> {
        use tokio::fs::File;
        use tokio::io::AsyncSeekExt;

        let filepath = self.recordings_dir().join(filename);

        if !filepath.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Recording not found",
            ));
        }

        let mut file = File::open(&filepath).await?;

        // Skip the 32-byte DCRR header
        file.seek(std::io::SeekFrom::Start(32)).await?;

        if self.is_recording_active(filename) {
            info!("Creating tailing reader for active recording: {}", filename);
            // For active recordings, create a tailing reader
            Ok(Box::new(TailingReader::new(
                file,
                filepath,
                filename.to_string(),
                self.clone(),
            )))
        } else {
            info!("Creating reader for completed recording: {}", filename);
            // For completed recordings, just return the file
            Ok(Box::new(file))
        }
    }

    /// Process an Asset frame: extract binary data, hash it, store it in CAS
    /// Determine if server-side fetch should be attempted based on fetch_error
    fn should_fetch_server_side(fetch_error: &domcorder_proto::AssetFetchError) -> bool {
        match fetch_error {
            domcorder_proto::AssetFetchError::CORS | domcorder_proto::AssetFetchError::Network => {
                true // CORS or network error - try server-side fetch
            }
            domcorder_proto::AssetFetchError::Http => {
                false // HTTP error (404, 500, etc.) - don't retry
            }
            domcorder_proto::AssetFetchError::Unknown(_) => {
                true // Unknown error - try server-side fetch as fallback
            }
            domcorder_proto::AssetFetchError::None => {
                false // No error - either success or legitimately empty
            }
        }
    }

    /// Returns an AssetReference frame with random_id for writing to recording
    /// Returns None if the asset is empty and server-side fetch also fails
    async fn process_asset_frame(
        &self,
        asset: &domcorder_proto::AssetData,
        site_origin: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<Option<domcorder_proto::AssetReferenceData>, Box<dyn std::error::Error + Send + Sync>> {
        let data = &asset.buf;
        
        // Check fetch_error to determine if we should attempt server-side fetch
        let should_fetch = Self::should_fetch_server_side(&asset.fetch_error);
        
        if data.is_empty() && should_fetch {
            // Log unknown errors
            if let domcorder_proto::AssetFetchError::Unknown(msg) = &asset.fetch_error {
                warn!("⚠️  Asset fetch unknown error: asset_id={}, url={}, error={}, attempting server-side fetch", 
                      asset.asset_id, asset.url, msg);
            }
            
            
            match crate::asset_cache::fetcher::fetch_and_cache_asset(
                &asset.url,
                user_agent,
                self.metadata_store.as_ref(),
                self.asset_file_store.as_ref(),
            ).await {
                Ok((sha256_hash, random_id)) => {
                    info!("✅ Successfully fetched asset server-side: random_id={}", &random_id[..16]);
                    
                    // Register asset usage on the site (if we have site context)
                    if let Some(origin) = site_origin {
                        let usage_params = AssetUsageParams {
                            site_origin: origin.to_string(),
                            url: asset.url.clone(),
                            sha256_hash: sha256_hash.clone(),
                            size: 0, // We don't know the actual size from the fetch result
                        };
                        if let Err(e) = self.metadata_store.register_asset_usage(usage_params).await {
                            warn!("Failed to register asset usage: {}", e);
                        }
                    }
                    
                    // Return AssetReference with random_id (for recording)
                    return Ok(Some(domcorder_proto::AssetReferenceData {
                        asset_id: asset.asset_id,
                        url: asset.url.clone(),
                        hash: random_id,
                        mime: asset.mime.clone(),
                    }));
                }
                Err(e) => {
                    warn!("❌ Failed to fetch asset server-side: {}", e);
                    // Skip this asset - both client and server fetch failed
                    return Ok(None);
                }
            }
        } else if data.is_empty() && !should_fetch {
            // Legitimately empty asset or HTTP error - skip it
            if matches!(asset.fetch_error, domcorder_proto::AssetFetchError::Http) {
                warn!("⚠️  Asset HTTP error: asset_id={}, url={}, skipping", 
                      asset.asset_id, asset.url);
            }
            return Ok(None);
        }

        // Compute SHA-256 hash (for storage and manifest)
        let sha256_hash = crate::asset_cache::hash::sha256(data);
        
        // Store asset and get/ensure random_id exists
        let mime = asset.mime.as_deref().unwrap_or("application/octet-stream");
        let random_id = store_or_get_asset_metadata(
            &sha256_hash,
            data,
            mime,
            self.metadata_store.as_ref(),
            self.asset_file_store.as_ref(),
        ).await?;

        // Register asset usage on the site (if we have site context)
        if let Some(origin) = site_origin {
            let usage_params = AssetUsageParams {
                site_origin: origin.to_string(),
                url: asset.url.clone(),
                sha256_hash: sha256_hash.clone(),
                size: data.len() as u64,
            };
            if let Err(e) = self.metadata_store.register_asset_usage(usage_params).await {
                warn!("Failed to register asset usage: {}", e);
            }
        }

        // Return AssetReference with random_id (for recording)
        Ok(Some(domcorder_proto::AssetReferenceData {
            asset_id: asset.asset_id,
            url: asset.url.clone(),
            hash: random_id,
            mime: asset.mime.clone(),
        }))
    }

    /// Process an AssetReference frame: verify server has the asset and resolve SHA-256 → random_id
    /// Returns AssetReference with random_id for writing to recording
    async fn process_asset_reference_frame(
        &self,
        asset_ref: &domcorder_proto::AssetReferenceData,
        site_origin: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<domcorder_proto::AssetReferenceData, Box<dyn std::error::Error + Send + Sync>> {
        // The hash field contains SHA-256 from the client
        // Resolve it to random_id for storage in the recording
        match self.metadata_store.resolve_hashes(&asset_ref.hash).await {
            Ok(Some(random_id)) => {
                // Asset exists! Just register usage
                debug!("✅ AssetReference verified: sha256={}, random_id={}", &asset_ref.hash[..16], &random_id[..16]);
                
                if let Some(origin) = site_origin {
                    let usage_params = AssetUsageParams {
                        site_origin: origin.to_string(),
                        url: asset_ref.url.clone(),
                        sha256_hash: asset_ref.hash.clone(), // Original SHA-256 from client
                        size: 0, // We don't know size from reference, but that's OK
                    };
                    if let Err(e) = self.metadata_store.register_asset_usage(usage_params).await {
                        warn!("Failed to register asset usage: {}", e);
                    }
                }
                
                // Get MIME type from metadata store
                let mime = self.metadata_store.get_asset_mime_type(&random_id).await
                    .ok()
                    .flatten();
                
                // Return AssetReference with random_id (for recording)
                Ok(domcorder_proto::AssetReferenceData {
                    asset_id: asset_ref.asset_id,
                    url: asset_ref.url.clone(),
                    hash: random_id,
                    mime,
                })
            }
            Ok(None) => {
                // Asset not found - try to fetch it server-side
                warn!("⚠️  AssetReference not found in cache: sha256={}, attempting server fetch", 
                      &asset_ref.hash[..16]);
                
                match crate::asset_cache::fetcher::fetch_and_cache_asset(
                    &asset_ref.url,
                    user_agent,
                    self.metadata_store.as_ref(),
                    self.asset_file_store.as_ref(),
                ).await {
                    Ok((fetched_sha256, fetched_random_id)) => {
                        // Verify the fetched hash matches what recorder expected
                        if fetched_sha256 != asset_ref.hash {
                            return Err(Box::new(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                format!("Hash mismatch: expected {}, got {}", 
                                       &asset_ref.hash[..16], &fetched_sha256[..16]),
                            )));
                        }
                        
                        // Register usage
                        if let Some(origin) = site_origin {
                            let usage_params = AssetUsageParams {
                                site_origin: origin.to_string(),
                                url: asset_ref.url.clone(),
                                sha256_hash: asset_ref.hash.clone(),
                                size: 0,
                            };
                            if let Err(e) = self.metadata_store.register_asset_usage(usage_params).await {
                                warn!("Failed to register asset usage: {}", e);
                            }
                        }
                        
                        // Get MIME type from metadata store
                        let mime = self.metadata_store.get_asset_mime_type(&fetched_random_id).await
                            .ok()
                            .flatten();
                        
                        // Return AssetReference with random_id (for recording)
                        Ok(domcorder_proto::AssetReferenceData {
                            asset_id: asset_ref.asset_id,
                            url: asset_ref.url.clone(),
                            hash: fetched_random_id,
                            mime,
                        })
                    }
                    Err(e) => {
                        warn!("Failed to fetch asset server-side: {}", e);
                        Err(Box::new(e))
                    }
                }
            }
            Err(e) => {
                warn!("Error checking asset cache: {}", e);
                Err(Box::new(e))
            }
        }
    }

    /// Filter function for frames - processes Asset and AssetReference frames
    /// Converts AssetData → AssetReference and resolves AssetReference hash (SHA-256 → random_id)
    async fn filter_frame_async(
        &self,
        frame: domcorder_proto::Frame,
        site_origin: Option<&str>,
        user_agent: Option<&str>,
    ) -> Option<domcorder_proto::Frame> {
        match &frame {
            // Process Asset frames: extract and cache the binary data, convert to AssetReference
            domcorder_proto::Frame::Asset(asset) => {
                match self.process_asset_frame(asset, site_origin, user_agent).await {
                    Ok(Some(asset_ref)) => {
                        // Convert to AssetReference frame with random_id
                        Some(domcorder_proto::Frame::AssetReference(asset_ref))
                    }
                    Ok(None) => {
                        // Empty asset - skip it
                        None
                    }
                    Err(e) => {
                        warn!("Failed to process asset frame: {}", e);
                        None // Skip this frame on error
                    }
                }
            }
            // Process AssetReference frames: resolve SHA-256 → random_id
            domcorder_proto::Frame::AssetReference(asset_ref) => {
                match self.process_asset_reference_frame(asset_ref, site_origin, user_agent).await {
                    Ok(asset_ref_with_random_id) => {
                        // Return AssetReference with random_id
                        Some(domcorder_proto::Frame::AssetReference(asset_ref_with_random_id))
                    }
                    Err(e) => {
                        warn!("Failed to process asset reference frame: {}", e);
                        None // Skip this frame on error
                    }
                }
            }
            // Heartbeat frames - keep connection alive but don't write to recording
            domcorder_proto::Frame::Heartbeat => {
                None // Skip heartbeat frames in recording
            }
            _ => Some(frame),
        }
    }

}

/// A reader that can tail a file that's still being written to
pub struct TailingReader {
    file: tokio::fs::File,
    filepath: std::path::PathBuf,
    filename: String,
    position: u64,
    storage_state: std::sync::Arc<StorageState>,
}

impl TailingReader {
    pub fn new(
        file: tokio::fs::File,
        filepath: std::path::PathBuf,
        filename: String,
        storage_state: std::sync::Arc<StorageState>,
    ) -> Self {
        Self {
            file,
            filepath,
            filename,
            position: 32, // Start after the header
            storage_state,
        }
    }
}

impl tokio::io::AsyncRead for TailingReader {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        use std::pin::Pin;

        // Try to read from the current position
        let poll_result = Pin::new(&mut self.file).poll_read(cx, buf);

        match poll_result {
            std::task::Poll::Ready(Ok(())) => {
                if buf.filled().is_empty() {
                    // No data available, check if file has grown
                    let metadata = match std::fs::metadata(&self.filepath) {
                        Ok(metadata) => metadata,
                        Err(e) => return std::task::Poll::Ready(Err(e)),
                    };

                    if metadata.len() > self.position {
                        // File has grown, seek to current position and try reading again
                        // Note: We need to wake the task to retry reading
                        cx.waker().wake_by_ref();
                        return std::task::Poll::Pending;
                    } else {
                        // File hasn't grown yet, check if recording is still active
                        if !self.storage_state.is_recording_active(&self.filename) {
                            // Recording is no longer active, return EOF
                            return std::task::Poll::Ready(Ok(()));
                        }

                        // Recording is still active, keep waiting
                        // TODO: Optimize this polling approach:
                        // 1. Use filesystem notifications (inotify/kqueue) to detect file changes
                        // 2. Register waker in active_recordings HashMap so mark_recording_completed()
                        //    can immediately wake all TailingReaders for that file
                        // 3. This would eliminate the 100ms polling delay and be more efficient

                        // Schedule a wake-up after a short delay (current polling approach)
                        let waker = cx.waker().clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                            waker.wake();
                        });
                        return std::task::Poll::Pending;
                    }
                } else {
                    // Successfully read some data
                    self.position += buf.filled().len() as u64;
                    std::task::Poll::Ready(Ok(()))
                }
            }
            other => other,
        }
    }
}
