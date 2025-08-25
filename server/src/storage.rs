use crate::{RecordingInfo, StorageState};
use chrono::Utc;
use domcorder_proto::{FileHeader, FrameReader, FrameWriter};
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use tokio::io::AsyncRead;
use tokio_stream::StreamExt;
use tracing::{error, info};
use uuid::Uuid;

impl StorageState {
    pub fn new(storage_dir: PathBuf) -> Self {
        // Ensure storage directory exists
        fs::create_dir_all(&storage_dir).expect("Failed to create storage directory");
        Self {
            storage_dir,
            active_recordings: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn generate_filename(&self) -> String {
        let timestamp = Utc::now().format("%Y-%m-%d_%H-%M-%S");
        let uuid = Uuid::new_v4().simple();
        format!("{}_{}.dcrr", timestamp, uuid)
    }

    pub fn save_recording(&self, data: &[u8]) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.storage_dir.join(&filename);

        let mut file = fs::File::create(&filepath)?;
        file.write_all(data)?;
        file.flush()?;

        Ok(filename)
    }

    pub fn list_recordings(&self) -> io::Result<Vec<RecordingInfo>> {
        let mut recordings = Vec::new();
        let active_recordings = self.active_recordings.lock().unwrap();

        for entry in fs::read_dir(&self.storage_dir)? {
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
        let filepath = self.storage_dir.join(filename);

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
        self.storage_dir.join(filename).exists()
    }

    /// Mark a recording as active (being written to)
    pub fn mark_recording_active(&self, filename: &str) {
        let mut active_recordings = self.active_recordings.lock().unwrap();
        active_recordings.insert(filename.to_string(), Utc::now());
    }

    /// Mark a recording as completed (no longer being written to)
    pub fn mark_recording_completed(&self, filename: &str) {
        let mut active_recordings = self.active_recordings.lock().unwrap();
        active_recordings.remove(filename);
    }

    /// Check if a recording is currently active
    pub fn is_recording_active(&self, filename: &str) -> bool {
        let active_recordings = self.active_recordings.lock().unwrap();
        active_recordings.contains_key(filename)
    }

    /// TEMPORARILY BYPASS FRAME PROCESSING: Stream raw data directly to file with header
    pub async fn save_recording_stream_raw<R: AsyncRead + Unpin>(
        &self,
        mut source: R,
    ) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.storage_dir.join(&filename);

        // Mark this recording as active
        self.mark_recording_active(&filename);

        // First, write the file header using the sync FrameWriter
        let header = FileHeader::new();
        {
            // Create a temporary sync file handle for header writing
            let sync_file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&filepath)?;
            let mut frame_writer = FrameWriter::new(sync_file);
            frame_writer.write_header(&header)?;
            frame_writer.flush()?;
        }

        // Reopen the file in append mode for async operations
        let mut output_file = tokio::fs::OpenOptions::new()
            .append(true)
            .open(&filepath)
            .await?;

        // Copy raw frame bytes directly after the header - no frame processing
        let bytes_copied = tokio::io::copy(&mut source, &mut output_file).await?;

        info!(
            "📁 Raw copy completed: {} bytes written to {} (plus header)",
            bytes_copied, filename
        );

        // Mark this recording as completed
        self.mark_recording_completed(&filename);

        Ok(filename)
    }

    /// Stream and validate frames from an AsyncRead source (frame data only, no header), writing them to a file
    pub async fn save_recording_stream_frames_only<R: AsyncRead + Unpin>(
        &self,
        source: R,
    ) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.storage_dir.join(&filename);

        // Mark this recording as active
        self.mark_recording_active(&filename);

        // Create the file for writing
        let output_file = fs::File::create(&filepath)?;
        let mut frame_writer = FrameWriter::new(output_file);

        // Create frame reader from the async source (no header expected)
        let mut frame_reader = FrameReader::new(source, false);

        // Create and write a new header with current timestamp
        let header = FileHeader::new();

        if let Err(e) = frame_writer.write_header(&header) {
            let failed_filename = format!("{}.failed", filename);
            let failed_filepath = self.storage_dir.join(&failed_filename);
            let _ = fs::rename(&filepath, &failed_filepath);
            return Err(e);
        }

        // Stream frames from input to output, validating each one
        while let Some(frame_result) = frame_reader.next().await {
            match frame_result {
                Ok(frame) => {
                    // Frame parsed successfully - apply filter (currently passthrough)
                    let filtered_frame = self.filter_frame(frame);

                    if let Some(frame) = filtered_frame {
                        // Write the validated frame to output
                        if let Err(e) = frame_writer.write_frame(&frame) {
                            let failed_filename = format!("{}.failed", filename);
                            let failed_filepath = self.storage_dir.join(&failed_filename);
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
                    let failed_filepath = self.storage_dir.join(&failed_filename);
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

    /// Stream and validate frames from an AsyncRead source, writing them to a file
    pub async fn save_recording_stream<R: AsyncRead + Unpin>(
        &self,
        source: R,
    ) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.storage_dir.join(&filename);

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
                let failed_filepath = self.storage_dir.join(&failed_filename);
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
            let failed_filepath = self.storage_dir.join(&failed_filename);
            let _ = fs::rename(&filepath, &failed_filepath);
            return Err(e);
        }

        // Stream frames from input to output, validating each one
        while let Some(frame_result) = frame_reader.next().await {
            match frame_result {
                Ok(frame) => {
                    // Frame parsed successfully - apply filter (currently passthrough)
                    let filtered_frame = self.filter_frame(frame);

                    if let Some(frame) = filtered_frame {
                        // Write the validated frame to output
                        if let Err(e) = frame_writer.write_frame(&frame) {
                            let failed_filename = format!("{}.failed", filename);
                            let failed_filepath = self.storage_dir.join(&failed_filename);
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
                    let failed_filepath = self.storage_dir.join(&failed_filename);
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

        let filepath = self.storage_dir.join(filename);

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
            // For active recordings, create a tailing reader
            Ok(Box::new(TailingReader::new(
                file,
                filepath,
                filename.to_string(),
                self.clone(),
            )))
        } else {
            // For completed recordings, just return the file
            Ok(Box::new(file))
        }
    }

    /// Filter function for frames - currently a passthrough, but can be extended later
    fn filter_frame(&self, frame: domcorder_proto::Frame) -> Option<domcorder_proto::Frame> {
        // For now, all frames that parse successfully are valid
        Some(frame)
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
