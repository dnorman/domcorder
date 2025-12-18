use crate::Frame;
use bincode::Options;
use std::io::{self, Write};

// File format constants
pub const DCRR_MAGIC: [u8; 4] = [0x44, 0x43, 0x52, 0x52]; // "DCRR"
pub const DCRR_VERSION: u32 = 1;
pub const HEADER_SIZE: usize = 32;

/// File header for .dcrr format
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileHeader {
    pub magic: [u8; 4],
    pub version: u32,
    pub created_at: u64, // Unix timestamp in milliseconds
    pub reserved: [u8; 16],
}

impl FileHeader {
    /// Create a new file header with current timestamp
    pub fn new() -> Self {
        Self {
            magic: DCRR_MAGIC,
            version: DCRR_VERSION,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            reserved: [0; 16],
        }
    }

    /// Create a new file header with specific timestamp
    pub fn with_timestamp(created_at: u64) -> Self {
        Self {
            magic: DCRR_MAGIC,
            version: DCRR_VERSION,
            created_at,
            reserved: [0; 16],
        }
    }
}

/// Writer for .dcrr file format and frame streams
pub struct FrameWriter<W: Write> {
    writer: W,
    header_written: bool,
}

impl<W: Write> FrameWriter<W> {
    /// Create a new frame writer
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            header_written: false,
        }
    }

    /// Write file header (only for .dcrr file format)
    pub fn write_header(&mut self, header: &FileHeader) -> io::Result<()> {
        if self.header_written {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Header already written",
            ));
        }

        // Write magic bytes (4 bytes)
        self.writer.write_all(&header.magic)?;

        // Write version (4 bytes, big-endian)
        self.writer.write_all(&header.version.to_be_bytes())?;

        // Write timestamp (8 bytes, big-endian)
        self.writer.write_all(&header.created_at.to_be_bytes())?;

        // Write reserved bytes (16 bytes)
        self.writer.write_all(&header.reserved)?;

        self.header_written = true;
        Ok(())
    }

    /// Write a frame to the stream (works for both file and stream formats)
    pub fn write_frame(&mut self, frame: &Frame) -> io::Result<()> {
        let config = bincode::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        let encoded = config
            .serialize(frame)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // Write frame length prefix (u32, big-endian)
        let len = encoded.len() as u32;
        self.writer.write_all(&len.to_be_bytes())?;

        // Write frame data
        self.writer.write_all(&encoded)?;
        Ok(())
    }

    /// Flush the underlying writer
    pub fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }

    /// Get the underlying writer
    pub fn into_inner(self) -> W {
        self.writer
    }

    /// Check if header has been written
    pub fn header_written(&self) -> bool {
        self.header_written
    }
}
