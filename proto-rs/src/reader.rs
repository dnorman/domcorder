use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio_stream::Stream;

use crate::Frame;
use crate::writer::{DCRR_MAGIC, DCRR_VERSION, FileHeader, HEADER_SIZE};
use bincode::Options;

/// Async stream-based reader for .dcrr file format and frame streams
pub struct FrameReader<R: AsyncRead + Unpin> {
    reader: R,
    header: Option<FileHeader>,
    buffer: Vec<u8>,
    header_read: bool,
    expect_header: bool,
}

impl<R: AsyncRead + Unpin> FrameReader<R> {
    /// Create a new async frame reader
    /// If expect_header is true, will try to read DCRR header first
    pub fn new(reader: R, expect_header: bool) -> Self {
        Self {
            reader,
            header: None,
            buffer: Vec::new(),
            header_read: false,
            expect_header,
        }
    }

    /// Get the file header if one was read
    pub fn header(&self) -> Option<&FileHeader> {
        self.header.as_ref()
    }

    /// Read the header (for compatibility with old API)
    pub async fn read_header(&mut self) -> io::Result<FileHeader> {
        self.read_header_if_needed().await?;
        self.header
            .clone()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "No header available"))
    }

    /// Read the next frame (for compatibility with old API)
    pub async fn read_frame(&mut self) -> io::Result<Option<Frame>> {
        self.read_header_if_needed().await?;
        self.try_read_frame().await
    }

    async fn read_header_if_needed(&mut self) -> io::Result<()> {
        if !self.expect_header || self.header_read {
            return Ok(());
        }

        let mut header_buf = [0u8; HEADER_SIZE];
        self.reader.read_exact(&mut header_buf).await?;

        // Check magic bytes
        if &header_buf[0..4] != &DCRR_MAGIC {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid DCRR magic bytes - not a .dcrr file",
            ));
        }

        // Parse version
        let version =
            u32::from_be_bytes([header_buf[4], header_buf[5], header_buf[6], header_buf[7]]);

        if version != DCRR_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Unsupported DCRR version: {} (expected {})",
                    version, DCRR_VERSION
                ),
            ));
        }

        // Parse timestamp
        let created_at = u64::from_be_bytes([
            header_buf[8],
            header_buf[9],
            header_buf[10],
            header_buf[11],
            header_buf[12],
            header_buf[13],
            header_buf[14],
            header_buf[15],
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

        self.header = Some(header);
        self.header_read = true;
        Ok(())
    }

    async fn try_read_frame(&mut self) -> io::Result<Option<Frame>> {
        // TODO: PERFORMANCE OPTIMIZATION - Add frame length prefix to protocol
        // Current approach tries to deserialize on every 4KB chunk, causing O(n²) complexity
        // for large frames. Should prefix each frame with its byte length (u32/u64) so we can:
        // 1. Read the length first (4-8 bytes)
        // 2. Read exactly that many bytes for the frame
        // 3. Deserialize once with complete data
        // This would eliminate the exponential parse attempts for large assets.

        let config = bincode::DefaultOptions::new()
            .with_big_endian()
            .with_fixint_encoding();

        // Read chunks until we can deserialize a complete frame
        let mut temp_buf = [0u8; 4096];
        let mut parse_attempts = 0;

        loop {
            // Try to deserialize from current buffer
            if !self.buffer.is_empty() {
                parse_attempts += 1;
                println!(
                    "🔍 Parse attempt #{}: buffer size {} bytes",
                    parse_attempts,
                    self.buffer.len()
                );

                let mut cursor = std::io::Cursor::new(&self.buffer);
                match config.deserialize_from(&mut cursor) {
                    Ok(frame) => {
                        // Success! Remove consumed bytes from buffer
                        let consumed = cursor.position() as usize;
                        println!(
                            "✅ Frame parsed successfully after {} attempts, consumed {} bytes",
                            parse_attempts, consumed
                        );
                        self.buffer.drain(..consumed);
                        return Ok(Some(frame));
                    }
                    Err(e) => {
                        // Check if this is just incomplete data
                        if let bincode::ErrorKind::Io(io_err) = e.as_ref() {
                            if io_err.kind() == io::ErrorKind::UnexpectedEof {
                                // Need more data, continue reading
                            } else {
                                return Err(io::Error::new(
                                    io::ErrorKind::InvalidData,
                                    format!("Failed to decode frame: {}", e),
                                ));
                            }
                        } else {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                format!("Failed to decode frame: {}", e),
                            ));
                        }
                    }
                }
            }

            // Read more data
            match self.reader.read(&mut temp_buf).await {
                Ok(0) => {
                    // End of stream
                    if self.buffer.is_empty() {
                        return Ok(None);
                    }
                    // Try final deserialize with remaining data
                    let mut cursor = std::io::Cursor::new(&self.buffer);
                    match config.deserialize_from(&mut cursor) {
                        Ok(frame) => {
                            let consumed = cursor.position() as usize;
                            self.buffer.drain(..consumed);
                            return Ok(Some(frame));
                        }
                        Err(_) => return Ok(None), // Incomplete frame at end
                    }
                }
                Ok(n) => {
                    self.buffer.extend_from_slice(&temp_buf[..n]);
                }
                Err(e) => return Err(e),
            }
        }
    }
}

impl<R: AsyncRead + Unpin> Stream for FrameReader<R> {
    type Item = io::Result<Frame>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        // Create a future for reading the next frame
        let fut = async {
            // Read header if needed
            if let Err(e) = self.read_header_if_needed().await {
                return Some(Err(e));
            }

            // Try to read the next frame
            match self.try_read_frame().await {
                Ok(Some(frame)) => Some(Ok(frame)),
                Ok(None) => None,
                Err(e) => Some(Err(e)),
            }
        };

        // Pin and poll the future
        let mut boxed = Box::pin(fut);
        boxed.as_mut().poll(cx)
    }
}
