use crate::{RecordingInfo, StorageState};
use chrono::Utc;
use domcorder_proto::{FileHeader, FrameReader, FrameWriter};
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use tokio::io::AsyncRead;
use tokio_stream::StreamExt;
use uuid::Uuid;

impl StorageState {
    pub fn new(storage_dir: PathBuf) -> Self {
        // Ensure storage directory exists
        fs::create_dir_all(&storage_dir).expect("Failed to create storage directory");
        Self { storage_dir }
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

        for entry in fs::read_dir(&self.storage_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) == Some("dcrr") {
                let metadata = fs::metadata(&path)?;
                let created = metadata
                    .created()
                    .map(|t| chrono::DateTime::from(t))
                    .unwrap_or_else(|_| Utc::now());

                recordings.push(RecordingInfo {
                    id: path.file_name().unwrap().to_string_lossy().to_string(),
                    filename: path.file_name().unwrap().to_string_lossy().to_string(),
                    size: metadata.len(),
                    created,
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

    /// Stream and validate frames from an AsyncRead source (frame data only, no header), writing them to a file
    pub async fn save_recording_stream_frames_only<R: AsyncRead + Unpin>(
        &self,
        source: R,
    ) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.storage_dir.join(&filename);

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
                    return Err(e);
                }
            }
        }

        // Flush the writer to ensure all data is written
        frame_writer.flush()?;

        Ok(filename)
    }

    /// Stream and validate frames from an AsyncRead source, writing them to a file
    pub async fn save_recording_stream<R: AsyncRead + Unpin>(
        &self,
        source: R,
    ) -> io::Result<String> {
        let filename = self.generate_filename();
        let filepath = self.storage_dir.join(&filename);

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
                    return Err(e);
                }
            }
        }

        // Flush the writer to ensure all data is written
        frame_writer.flush()?;

        Ok(filename)
    }

    /// Filter function for frames - currently a passthrough, but can be extended later
    fn filter_frame(&self, frame: domcorder_proto::Frame) -> Option<domcorder_proto::Frame> {
        // For now, all frames that parse successfully are valid
        Some(frame)
    }
}
