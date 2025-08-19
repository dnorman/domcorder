#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RecordingInfo, StorageState};
    use domcorder_proto::{FileHeader, Frame, FrameReader, FrameWriter};
    use std::fs;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;
    use tempfile::TempDir;

    // Include the sample file at compile time
    const SAMPLE_FILE_DATA: &[u8] = include_bytes!("../../.sample_data/proto/file-basic.dcrr");

    fn create_test_storage() -> (StorageState, TempDir) {
        let temp_dir = tempfile::tempdir().unwrap();
        let storage = StorageState::new(temp_dir.path().to_path_buf());
        (storage, temp_dir)
    }

    #[test]
    fn test_storage_save_and_list_recordings() {
        let (storage, temp_dir) = create_test_storage();

        // Create test data
        let test_data = b"test recording content";

        // Save recording
        let filename = storage.save_recording(test_data).unwrap();
        assert!(filename.ends_with(".dcrr"));

        // List recordings
        let recordings = storage.list_recordings().unwrap();
        assert_eq!(recordings.len(), 1);
        assert_eq!(recordings[0].filename, filename);
        assert_eq!(recordings[0].size, test_data.len() as u64);
    }

    #[test]
    fn test_storage_get_recording() {
        let (storage, _temp_dir) = create_test_storage();

        let test_data = b"test recording content";
        let filename = storage.save_recording(test_data).unwrap();

        // Get recording
        let retrieved_data = storage.get_recording(&filename).unwrap();
        assert_eq!(retrieved_data, test_data);
    }

    #[test]
    fn test_storage_nonexistent_recording() {
        let (storage, _temp_dir) = create_test_storage();

        let result = storage.get_recording("nonexistent.dcrr");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_frame_validation() {
        // Test that we can create and read valid frames
        let mut writer = FrameWriter::new(Cursor::new(Vec::new()));
        let header = FileHeader::new();
        writer.write_header(&header).unwrap();

        let timestamp_frame = Frame::Timestamp(domcorder_proto::TimestampData {
            timestamp: 1234567890,
        });
        writer.write_frame(&timestamp_frame).unwrap();

        let frame_data = writer.into_inner().into_inner();

        // Verify we can read it back
        let mut reader = FrameReader::new(Cursor::new(&frame_data), true);
        let read_header = reader.read_header().await.unwrap();
        assert_eq!(read_header.version, 1);

        let frame = reader.read_frame().await.unwrap();
        assert!(frame.is_some());
    }

    #[test]
    fn test_storage_generate_filename() {
        let (storage, _temp_dir) = create_test_storage();

        let filename1 = storage.generate_filename();
        let filename2 = storage.generate_filename();

        // Should be different due to UUID
        assert_ne!(filename1, filename2);

        // Should have correct format
        assert!(filename1.ends_with(".dcrr"));
        assert!(filename1.contains("_"));
    }

    #[tokio::test]
    async fn test_sample_file_validation() {
        // Test that the sample file can be read and validated
        let sample_data = SAMPLE_FILE_DATA;

        // Verify it's a valid DCRR file by checking the header
        assert_eq!(
            &sample_data[0..4],
            b"DCRR",
            "File should start with DCRR magic bytes"
        );
        assert_eq!(sample_data.len(), 1012, "Sample file should be 1012 bytes");

        // Verify we can read it as a valid DCRR file using proto-rs
        let mut reader = FrameReader::new(Cursor::new(sample_data), true);
        let header = reader
            .read_header()
            .await
            .expect("Should be able to read header");
        assert_eq!(
            &header.magic, b"DCRR",
            "Header should have correct magic bytes"
        );
        assert_eq!(header.version, 1, "Header should have version 1");

        // Try to read at least one frame
        let frame = reader
            .read_frame()
            .await
            .expect("Should be able to read frames");
        assert!(frame.is_some(), "Should have at least one frame");
    }

    #[tokio::test]
    async fn test_sample_file_storage_roundtrip() {
        // Test that the sample file can be saved and retrieved correctly
        let (storage, _temp_dir) = create_test_storage();

        // Use the compile-time included sample file
        let sample_data = SAMPLE_FILE_DATA;

        // Save it using our storage
        let filename = storage.save_recording(sample_data).unwrap();
        assert!(filename.ends_with(".dcrr"));

        // Retrieve it
        let saved_data = storage.get_recording(&filename).unwrap();

        // Verify the data matches exactly
        assert_eq!(
            saved_data, sample_data,
            "Saved data should match uploaded data"
        );
        assert_eq!(saved_data.len(), 1012, "Saved file should be 1012 bytes");

        // Verify we can still read it as a valid DCRR file
        let mut reader = FrameReader::new(Cursor::new(&saved_data), true);
        let header = reader
            .read_header()
            .await
            .expect("Should be able to read header");
        assert_eq!(
            &header.magic, b"DCRR",
            "Header should have correct magic bytes"
        );
        assert_eq!(header.version, 1, "Header should have version 1");

        // Try to read at least one frame
        let frame = reader
            .read_frame()
            .await
            .expect("Should be able to read frames");
        assert!(frame.is_some(), "Should have at least one frame");
    }

    #[tokio::test]
    async fn test_streaming_sample_file() {
        // Test that the sample file can be processed via streaming
        let (storage, _temp_dir) = create_test_storage();

        // Create a Cursor from the sample data to simulate streaming
        let sample_data = SAMPLE_FILE_DATA;
        let cursor = Cursor::new(sample_data);

        // Use the new streaming save method
        let filename = storage.save_recording_stream(cursor).await.unwrap();
        assert!(filename.ends_with(".dcrr"));

        // Retrieve and verify the saved file
        let saved_data = storage.get_recording(&filename).unwrap();
        assert_eq!(
            saved_data, sample_data,
            "Streamed data should match original"
        );

        // Verify the file is still valid
        let mut reader = FrameReader::new(Cursor::new(&saved_data), true);
        let header = reader
            .read_header()
            .await
            .expect("Should be able to read header");
        assert_eq!(header.version, 1, "Header should have version 1");

        let frame = reader
            .read_frame()
            .await
            .expect("Should be able to read frames");
        assert!(frame.is_some(), "Should have at least one frame");
    }
}
