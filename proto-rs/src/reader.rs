use std::io::{self, Read, BufRead, BufReader};
use bincode::Options;
use crate::Frame;
use crate::writer::{FileHeader, DCRR_MAGIC, DCRR_VERSION, HEADER_SIZE};

/// Reader for .dcrr file format and frame streams
pub struct FrameReader<R: Read> {
    reader: BufReader<R>,
    header: Option<FileHeader>,
    position: usize,
}

impl<R: Read> FrameReader<R> {
    /// Create a new frame reader
    pub fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
            header: None,
            position: 0,
        }
    }

    /// Try to read file header (fallible - returns error if not a .dcrr file)
    pub fn read_header(&mut self) -> io::Result<FileHeader> {
        if let Some(ref header) = self.header {
            return Ok(header.clone());
        }

        let mut header_buf = [0u8; HEADER_SIZE];
        self.reader.read_exact(&mut header_buf)?;
        
        // Check magic bytes
        if &header_buf[0..4] != &DCRR_MAGIC {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid DCRR magic bytes - not a .dcrr file",
            ));
        }
        
        // Parse version
        let version = u32::from_be_bytes([
            header_buf[4], header_buf[5], header_buf[6], header_buf[7]
        ]);
        
        if version != DCRR_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Unsupported DCRR version: {} (expected {})", version, DCRR_VERSION),
            ));
        }
        
        // Parse timestamp
        let created_at = u64::from_be_bytes([
            header_buf[8], header_buf[9], header_buf[10], header_buf[11],
            header_buf[12], header_buf[13], header_buf[14], header_buf[15],
        ]);
        
        // Parse reserved bytes
        let mut reserved = [0u8; 16];
        reserved.copy_from_slice(&header_buf[16..32]);
        
        let header = FileHeader {
            magic: DCRR_MAGIC,
            version,
            created_at,
            reserved,
        };
        
        self.header = Some(header.clone());
        self.position += HEADER_SIZE;
        Ok(header)
    }

    /// Read the next frame from the stream
    /// Returns Ok(None) when end of stream is reached
    pub fn read_frame(&mut self) -> io::Result<Option<Frame>> {
        let config = bincode::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        // Check if we have data available
        let available = self.reader.fill_buf()?;
        if available.is_empty() {
            return Ok(None); // End of stream
        }

        // Use bincode's deserialize_from which reads exactly one value and leaves the rest
        match config.deserialize_from(&mut self.reader) {
            Ok(frame) => {
                // bincode automatically consumed the correct number of bytes
                Ok(Some(frame))
            }
            Err(e) => {
                // Check if this is EOF
                if let bincode::ErrorKind::Io(io_err) = e.as_ref() {
                    if io_err.kind() == io::ErrorKind::UnexpectedEof {
                        return Ok(None);
                    }
                }
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Failed to decode frame: {}", e),
                ))
            }
        }
    }

    /// Get the file header if one was read
    pub fn header(&self) -> Option<&FileHeader> {
        self.header.as_ref()
    }

    /// Get current position in stream
    pub fn position(&self) -> usize {
        self.position
    }

    /// Read all remaining frames into a vector
    pub fn read_all_frames(&mut self) -> io::Result<Vec<Frame>> {
        let mut frames = Vec::new();
        
        while let Some(frame) = self.read_frame()? {
            frames.push(frame);
        }
        
        Ok(frames)
    }
}

// Users should create FrameReader directly and decide whether to call read_header()
// If read_header() fails with "Invalid DCRR magic bytes", treat as raw stream
// If read_header() succeeds, it's a .dcrr file format