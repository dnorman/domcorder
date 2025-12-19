//! Reusable WebSocket recording handler with hooks for customization
//!
//! This module extracts the WebSocket recording logic so it can be reused
//! by both the domcorder server and simplikeys, with hooks for custom behavior.

use crate::asset_cache::manifest::generate_manifest;
use crate::AppState;
use axum::extract::ws::{Message, WebSocket};
use domcorder_proto::{Frame, FrameReader, FrameWriter, CacheManifestData, ManifestEntryData};
use futures_util::{SinkExt, StreamExt};
use std::error::Error;
use std::io;
use std::io::Cursor;
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;
use tracing::{debug, error, info, warn};

/// Configuration for the recording handler
pub struct RecordingConfig {
    pub max_size: usize,
    pub subdir: Option<PathBuf>,
    pub custom_filename: Option<String>,
}

/// Hooks for customizing behavior (for simplikeys integration)
pub struct RecordingHooks {
    /// Called before starting the recording to validate the connection
    /// Returns the filename to use, or an error message
    pub on_start: Option<
        Box<
            dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
                + Send
                + Sync,
        >,
    >,

    /// Called when RecordingMetadata is received
    /// Can return custom site_origin or None to use default
    pub on_metadata: Option<
        Box<
            dyn Fn(&str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Option<String>, String>> + Send>>
                + Send
                + Sync,
        >,
    >,

    /// Called after recording completes successfully
    pub on_complete: Option<
        Box<
            dyn Fn(&str, usize) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
                + Send
                + Sync,
        >,
    >,

    /// Called if recording fails
    pub on_error: Option<
        Box<dyn Fn(&str) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> + Send + Sync>,
    >,
}

/// Main reusable WebSocket recording handler
///
/// This handles:
/// - Waiting for RecordingMetadata frame
/// - Registering recording and generating cache manifest
/// - Streaming frames with asset caching
/// - Frame processing and validation
///
/// Simplikeys can call this from its own axum handlers
pub async fn handle_websocket_recording(
    socket: WebSocket,
    state: AppState,
    user_agent: Option<String>,
    config: RecordingConfig,
    hooks: RecordingHooks,
) {
    info!("🔌 WebSocket connection established for recording");

    let (mut sender, mut receiver) = socket.split();

    // Wait for RecordingMetadata frame to get initial_url
    let mut site_origin: Option<String> = None;
    let mut filename: Option<String> = None;

    // Buffer for initial frames until we get metadata
    let mut frame_buffer = Vec::new();

    // Read initial frames to find RecordingMetadata
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                frame_buffer.push(data);

                // Try to parse frames from the buffer to find RecordingMetadata
                if !frame_buffer.is_empty() && site_origin.is_none() {
                    let combined = frame_buffer.concat();
                    let cursor = std::io::Cursor::new(combined);
                    let mut reader = FrameReader::new(cursor, false);

                    if let Some(Ok(frame)) = reader.next().await {
                        if let Frame::RecordingMetadata(metadata) = frame {
                            info!("📋 Received RecordingMetadata: initial_url={}", metadata.initial_url);

                            // Call on_start hook if provided (for simplikeys entity creation)
                            let final_filename = if let Some(ref on_start) = hooks.on_start {
                                match on_start().await {
                                    Ok(fname) => {
                                        filename = Some(fname.clone());
                                        fname
                                    }
                                    Err(e) => {
                                        error!("❌ on_start hook failed: {}", e);
                                        let _ = sender.send(Message::Text(e.into())).await;
                                        let _ = sender.close().await;
                                        return;
                                    }
                                }
                            } else {
                                // Use config filename or generate default
                                config
                                    .custom_filename
                                    .clone()
                                    .unwrap_or_else(|| state.generate_filename())
                            };

                            // Register recording and extract site origin
                            match state
                                .metadata_store
                                .register_recording(&final_filename, &metadata.initial_url)
                                .await
                            {
                                Ok(site_info) => {
                                    // Call on_metadata hook if provided
                                    let origin = if let Some(ref on_metadata) = hooks.on_metadata {
                                        match on_metadata(&metadata.initial_url).await {
                                            Ok(Some(custom_origin)) => custom_origin,
                                            Ok(None) => site_info.origin.clone(),
                                            Err(e) => {
                                                error!("❌ on_metadata hook failed: {}", e);
                                                let _ = sender.close().await;
                                                return;
                                            }
                                        }
                                    } else {
                                        site_info.origin.clone()
                                    };

                                    site_origin = Some(origin.clone());

                                    // Generate and send cache manifest as a binary frame
                                    match generate_manifest(state.metadata_store.as_ref(), &origin, None).await {
                                        Ok(manifest) => {
                                            info!("📦 Sending cache manifest with {} entries", manifest.assets.len());

                                            // Convert manifest to frame data
                                            let manifest_entries: Vec<ManifestEntryData> = manifest
                                                .assets
                                                .iter()
                                                .map(|e| ManifestEntryData {
                                                    url: e.url.clone(),
                                                    sha256_hash: e.sha256_hash.clone(),
                                                })
                                                .collect();

                                            let manifest_frame = Frame::CacheManifest(CacheManifestData {
                                                site_origin: manifest.site_origin.clone(),
                                                assets: manifest_entries,
                                            });

                                            // Encode frame to bytes
                                            let mut buffer = Vec::new();
                                            let mut cursor = Cursor::new(&mut buffer);
                                            let mut frame_writer = FrameWriter::new(&mut cursor);

                                            if let Err(e) = frame_writer.write_frame(&manifest_frame) {
                                                error!("Failed to encode manifest frame: {}", e);
                                                let _ = sender.close().await;
                                                return;
                                            }

                                            // Send as binary message
                                            let buffer_len = buffer.len();
                                            let bytes = buffer.into();
                                            if let Err(e) = sender.send(Message::Binary(bytes)).await {
                                                error!("Failed to send manifest frame: {}", e);
                                                let _ = sender.close().await;
                                                return;
                                            }
                                            info!("✅ Sent cache manifest frame ({} bytes)", buffer_len);
                                        }
                                        Err(e) => {
                                            error!("Failed to generate manifest: {}", e);
                                            let _ = sender.close().await;
                                            return;
                                        }
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to register recording: {}", e);
                                    let _ = sender.close().await;
                                    return;
                                }
                            }

                            // Continue processing - the metadata frame will be written to the recording
                            break;
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("🔌 WebSocket closed before metadata received");
                return;
            }
            Err(e) => {
                // Check if this is a normal close vs a real error
                let is_normal_close = e
                    .source()
                    .and_then(|err| err.downcast_ref::<io::Error>())
                    .map(|io_err| {
                        matches!(
                            io_err.kind(),
                            io::ErrorKind::ConnectionReset
                                | io::ErrorKind::BrokenPipe
                                | io::ErrorKind::UnexpectedEof
                        )
                    })
                    .unwrap_or_else(|| {
                        // Fallback to string check if source chain doesn't have io::Error
                        let err_str = e.to_string();
                        err_str.contains("connection closed")
                            || err_str.contains("broken pipe")
                            || err_str.contains("Connection reset")
                    });

                if is_normal_close {
                    debug!("🔌 WebSocket connection closed normally while waiting for metadata");
                } else {
                    error!("WebSocket error while waiting for metadata: {}", e);
                }
                return;
            }
            _ => {}
        }
    }

    // Get final filename
    let final_filename = filename.unwrap_or_else(|| {
        config
            .custom_filename
            .clone()
            .unwrap_or_else(|| state.generate_filename())
    });

    // Create a pipe to stream WebSocket data to the save method
    let (mut pipe_writer, pipe_reader) = tokio::io::duplex(8192);

    // Calculate total bytes from buffer before moving it
    let mut total_bytes = frame_buffer.iter().map(|b| b.len()).sum::<usize>();

    // Write buffered frames to pipe
    for data in frame_buffer {
        if let Err(e) = pipe_writer.write_all(&data).await {
            error!("Failed to write buffered frame: {}", e);
            let _ = sender.close().await;
            return;
        }
    }

    // Spawn a task to handle the streaming save with site_origin and user_agent
    // Use the frame processing method (not raw) to get asset caching
    let state_clone = state.clone();
    let site_origin_clone = site_origin.clone();
    let user_agent_clone = user_agent.clone();
    let filename_for_save = final_filename.clone();
    let subdir_clone = config.subdir.clone();

    let save_task = tokio::spawn(async move {
        state_clone
            .save_recording_stream_frames_only_with_site_and_path(
                pipe_reader,
                site_origin_clone.as_deref(),
                user_agent_clone.as_deref(),
                subdir_clone,
                Some(filename_for_save),
            )
            .await
    });

    // Process remaining WebSocket messages and stream to pipe
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                total_bytes += data.len();

                // Safety check: prevent runaway recordings
                if total_bytes > config.max_size {
                    let error_msg = format!("Recording too large ({} bytes)", total_bytes);
                    error!("❌ {}", error_msg);

                    if let Some(ref on_error) = hooks.on_error {
                        on_error(&error_msg).await;
                    }
                    let _ = sender.close().await;
                    return;
                }

                // Write data to the pipe (streams to disk with frame processing)
                if let Err(e) = pipe_writer.write_all(&data).await {
                    let error_msg = format!("Failed to write to pipe: {}", e);
                    error!("❌ {}", error_msg);

                    if let Some(ref on_error) = hooks.on_error {
                        on_error(&error_msg).await;
                    }
                    let _ = sender.close().await;
                    return;
                }
            }
            Ok(Message::Text(_)) => {
                warn!("Received unexpected text message, ignoring");
            }
            Ok(Message::Close(_)) => {
                info!("🔌 WebSocket connection closed, finalizing recording");
                break;
            }
            Err(e) => {
                // Check if this is a normal close vs a real error
                let is_normal_close = e
                    .source()
                    .and_then(|err| err.downcast_ref::<io::Error>())
                    .map(|io_err| {
                        matches!(
                            io_err.kind(),
                            io::ErrorKind::ConnectionReset
                                | io::ErrorKind::BrokenPipe
                                | io::ErrorKind::UnexpectedEof
                        )
                    })
                    .unwrap_or_else(|| {
                        // Fallback to string check if source chain doesn't have io::Error
                        let err_str = e.to_string();
                        err_str.contains("connection closed")
                            || err_str.contains("broken pipe")
                            || err_str.contains("Connection reset")
                    });

                if is_normal_close {
                    debug!("🔌 WebSocket connection closed normally, finalizing recording");
                } else {
                    error!("WebSocket error: {}", e);
                }
                break;
            }
            _ => {
                debug!("Received other message type");
            }
        }
    }

    // Close the pipe writer to signal end of stream
    info!("🔌 Closing pipe writer, total bytes processed: {}", total_bytes);
    drop(pipe_writer);

    // Wait for the save task to complete
    match save_task.await {
        Ok(Ok(saved_filename)) => {
            info!("✅ Recording saved as {} ({} bytes)", saved_filename, total_bytes);

            if let Some(ref on_complete) = hooks.on_complete {
                on_complete(&saved_filename, total_bytes).await;
            }

            let _ = sender.close().await;
        }
        Ok(Err(e)) => {
            let error_msg = format!("Failed to save recording: {}", e);
            error!("❌ {}", error_msg);

            if let Some(ref on_error) = hooks.on_error {
                on_error(&error_msg).await;
            }
            let _ = sender.close().await;
        }
        Err(e) => {
            let error_msg = format!("Save task panicked: {}", e);
            error!("❌ {}", error_msg);

            if let Some(ref on_error) = hooks.on_error {
                on_error(&error_msg).await;
            }
            let _ = sender.close().await;
        }
    }

    info!("🔌 WebSocket connection ended");
}

