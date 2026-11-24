//! Reusable WebSocket recording handler with hooks for customization
//!
//! This module extracts the WebSocket recording logic so it can be reused
//! by both the domcorder server and simplikeys, with hooks for custom behavior.

use crate::asset_cache::manifest::generate_manifest;
use crate::logged_url::LoggedUrl;
use crate::AppState;
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket};
use domcorder_proto::{Frame, FrameReader, FrameWriter, CacheManifestData, ManifestEntryData};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use std::error::Error;
use std::io;
use std::io::Cursor;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::io::StreamReader;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

/// How long the handler waits for its close frame to be written to the socket. A peer that has
/// stopped reading can leave the socket no room for the frame.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

/// Configuration for the recording handler
pub struct RecordingConfig {
    pub max_size: usize,
    pub subdir: Option<PathBuf>,
    pub custom_filename: Option<String>,
    /// Lets the caller end the recording. Once the token is cancelled, the handler reads nothing
    /// more from the socket. A hook of the caller's that is running when the stop comes runs to
    /// its end first. What follows depends on what the handler is doing:
    /// - Waiting for the recording's metadata frame: the socket is closed, no hook is called and
    ///   no recording is made.
    /// - Setting the recording up once its metadata frame has arrived (`on_start`, its
    ///   registration, `on_metadata`, the cache manifest): the setup goes on, `on_start` and
    ///   `on_metadata` included, but the handler does not wait to send the manifest (below). The
    ///   messages read until then, which hold the metadata frame, are handed to the save, and the
    ///   recording ends as when streaming; if those messages pass `max_size`, `on_error` is
    ///   called instead and no recording is made.
    /// - Streaming: a message the handler is waiting to hand to a save that has fallen behind is
    ///   dropped. The socket is closed, the messages handed to the save reach its input and go
    ///   through its ordinary processing, and `on_complete` is called once if the save succeeds,
    ///   or `on_error` if it fails.
    /// - Waiting for the save, or in `on_complete` or `on_error`: nothing changes.
    ///
    /// A hook that fails ends the recording as it would without a stop. Once the stop has come,
    /// the handler no longer waits to send the page the cache manifest or a failed `on_start`'s
    /// error. If the stop came before the handler began to send one, it is not sent; otherwise
    /// the close that follows can still deliver it whole to a peer that reads within the close's
    /// 5 seconds.
    ///
    /// The save's input ends after the last whole message handed to it. Whether the stored
    /// recording then reads whole depends on what the client sent: a message that ends inside a
    /// frame leaves a recording that the save marks failed, as on a close. The page's recorder
    /// sends each frame whole in one message.
    ///
    /// The handler waits at most 5 seconds for its close frame to be written, and drops both
    /// halves of the socket if the close has not finished by then, so a peer that has stopped
    /// reading may never get a close frame. `on_complete` or `on_error` is called once the save
    /// has ended, except when a message takes the recording past `max_size` while streaming:
    /// then `on_error` is called without waiting for the save. Before it ends, the save may
    /// fetch assets handed to it that the page could not fetch, with a 30-second timeout for
    /// each fetch.
    ///
    /// `None` leaves the recording to end with the socket.
    pub stop: Option<CancellationToken>,
}

/// Hooks for customizing behavior (for simplikeys integration)
pub struct RecordingHooks {
    /// Called before starting the recording to validate the connection
    /// Returns the filename to use, or an error message. The handler logs the error's text as
    /// it is, so keep addresses out of it.
    pub on_start: Option<
        Box<
            dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
                + Send
                + Sync,
        >,
    >,

    /// Called when RecordingMetadata is received
    /// Can return custom site_origin or None to use default. The handler logs an error's text
    /// as it is, so keep addresses out of it.
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
    loop {
        let msg = tokio::select! {
            biased;
            _ = stopped(&config.stop) => {
                info!("🛑 Recording stopped before metadata received");
                close_socket(&mut sender).await;
                return;
            }
            msg = receiver.next() => match msg {
                Some(msg) => msg,
                None => break,
            },
        };
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
                            info!("📋 Received RecordingMetadata: initial_url={}", LoggedUrl(&metadata.initial_url));

                            // Call on_start hook if provided (for simplikeys entity creation)
                            let final_filename = if let Some(ref on_start) = hooks.on_start {
                                match on_start().await {
                                    Ok(fname) => {
                                        filename = Some(fname.clone());
                                        fname
                                    }
                                    Err(e) => {
                                        error!("❌ on_start hook failed: {}", e);
                                        // Send the error to the page, unless the recording is
                                        // stopped first: the error can be of any length, and a
                                        // peer that has stopped reading must not hold a stopped
                                        // recording open
                                        tokio::select! {
                                            biased;
                                            _ = stopped(&config.stop) => {
                                                info!("🛑 Recording stopped, on_start's error not sent");
                                            }
                                            _ = sender.send(Message::Text(e.into())) => {}
                                        }
                                        close_socket(&mut sender).await;
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
                                                close_socket(&mut sender).await;
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
                                                close_socket(&mut sender).await;
                                                return;
                                            }

                                            // Send as binary message, unless the recording is
                                            // stopped first: a peer that has stopped reading
                                            // must not hold a stopped recording open
                                            let buffer_len = buffer.len();
                                            let bytes = buffer.into();
                                            tokio::select! {
                                                biased;
                                                _ = stopped(&config.stop) => {
                                                    info!("🛑 Recording stopped, cache manifest not sent");
                                                }
                                                sent = sender.send(Message::Binary(bytes)) => {
                                                    if let Err(e) = sent {
                                                        error!("Failed to send manifest frame: {}", e);
                                                        close_socket(&mut sender).await;
                                                        return;
                                                    }
                                                    info!("✅ Sent cache manifest frame ({} bytes)", buffer_len);
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            error!("Failed to generate manifest: {}", e);
                                            close_socket(&mut sender).await;
                                            return;
                                        }
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to register recording: {}", e);
                                    close_socket(&mut sender).await;
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

    // The messages read while waiting for the metadata frame hold it, so they are handed to the
    // save even after a stop, unless they pass the size limit: they count toward it, and are
    // checked before the save makes its file.
    let buffered_bytes: usize = frame_buffer.iter().map(Bytes::len).sum();
    if buffered_bytes > config.max_size {
        end_too_large(buffered_bytes, &hooks, &mut sender).await;
        return;
    }

    // The save is handed whole messages through a channel, so that a hand-off a stop cuts short
    // leaves it no part of a message. The channel holds one message: a save that falls behind
    // holds back the socket's reads, with two messages waiting on it, the one in the channel and
    // the one its reader last read and keeps until it reads on.
    let (to_save, handed_to_save) = mpsc::channel::<io::Result<Bytes>>(1);
    let save_input = StreamReader::new(ReceiverStream::new(handed_to_save));

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
                save_input,
                site_origin_clone.as_deref(),
                user_agent_clone.as_deref(),
                subdir_clone,
                Some(filename_for_save),
            )
            .await
    });

    // Hand the save the messages read while waiting for the metadata frame. A send fails only
    // once the save has ended, and the recording's end reports what the save ended with.
    let mut total_bytes = 0;
    for data in frame_buffer {
        let message_bytes = data.len();
        if to_save.send(Ok(data)).await.is_err() {
            return end_recording(sender, receiver, to_save, save_task, total_bytes, &hooks).await;
        }
        total_bytes += message_bytes;
    }

    // Process remaining WebSocket messages and hand them to the save
    loop {
        let msg = tokio::select! {
            biased;
            _ = stopped(&config.stop) => {
                info!("🛑 Recording stopped, finalizing recording");
                break;
            }
            msg = receiver.next() => match msg {
                Some(msg) => msg,
                None => break,
            },
        };
        match msg {
            Ok(Message::Binary(data)) => {
                let message_bytes = data.len();

                // Safety check: prevent runaway recordings
                if total_bytes + message_bytes > config.max_size {
                    // Let the save end with what it was given before `on_error` and the socket's
                    // close, which a slow hook or a peer that has stopped reading can hold
                    drop(to_save);
                    end_too_large(total_bytes + message_bytes, &hooks, &mut sender).await;
                    return;
                }

                // Hand the message to the save (streams to disk with frame processing). A stop
                // while the save is behind drops the message, and ends the loop at its top.
                tokio::select! {
                    biased;
                    _ = stopped(&config.stop) => continue,
                    handed = to_save.send(Ok(data)) => {
                        // A send fails only once the save has ended, and the recording's end
                        // reports what the save ended with
                        if handed.is_err() {
                            break;
                        }
                    }
                }
                total_bytes += message_bytes;
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

    end_recording(sender, receiver, to_save, save_task, total_bytes, &hooks).await;
}

/// Ends a recording whose save has started, unless the size limit ends it while streaming
/// (`end_too_large`): lets go of the save's input, closes the socket, waits for the save, and
/// calls `on_complete` or `on_error` with what the save ended with.
async fn end_recording(
    mut sender: SplitSink<WebSocket, Message>,
    receiver: SplitStream<WebSocket>,
    to_save: mpsc::Sender<io::Result<Bytes>>,
    save_task: JoinHandle<io::Result<String>>,
    total_bytes: usize,
    hooks: &RecordingHooks,
) {
    // Close the save's input to signal end of stream. It is let go before the socket is closed,
    // so that the save reaches its end whatever the peer does.
    info!("🔌 Closing the save's input, total bytes processed: {}", total_bytes);
    drop(to_save);

    // Close the socket before waiting for the save, so that a stop sends the page its close frame
    // while the save is still working through what it was given. The handler keeps the
    // connection until the recording has ended, unless the close times out.
    if !close_socket(&mut sender).await {
        // The peer has stopped reading: let go of the connection rather than keep it open until
        // the save finishes
        drop(sender);
        drop(receiver);
    }

    // Wait for the save task to complete
    match save_task.await {
        Ok(Ok(saved_filename)) => {
            info!("✅ Recording saved as {} ({} bytes)", saved_filename, total_bytes);

            if let Some(ref on_complete) = hooks.on_complete {
                on_complete(&saved_filename, total_bytes).await;
            }
        }
        Ok(Err(e)) => {
            let error_msg = format!("Failed to save recording: {}", e);
            error!("❌ {}", error_msg);

            if let Some(ref on_error) = hooks.on_error {
                on_error(&error_msg).await;
            }
        }
        Err(e) => {
            let error_msg = format!("Save task panicked: {}", e);
            error!("❌ {}", error_msg);

            if let Some(ref on_error) = hooks.on_error {
                on_error(&error_msg).await;
            }
        }
    }

    info!("🔌 WebSocket connection ended");
}

/// Ends a recording that `bytes` would take past `max_size`: the error goes to the log and to
/// `on_error`, and the socket is closed. A save that has started is not waited for.
async fn end_too_large(
    bytes: usize,
    hooks: &RecordingHooks,
    sender: &mut SplitSink<WebSocket, Message>,
) {
    let error_msg = format!("Recording too large ({} bytes)", bytes);
    error!("❌ {}", error_msg);

    if let Some(ref on_error) = hooks.on_error {
        on_error(&error_msg).await;
    }
    close_socket(sender).await;
}

/// Closes the socket with a close frame, and reports whether the close finished within
/// `CLOSE_TIMEOUT`.
async fn close_socket(sender: &mut SplitSink<WebSocket, Message>) -> bool {
    timeout(CLOSE_TIMEOUT, sender.close()).await.is_ok()
}

/// Resolves once the caller stops the recording, and never when the caller gave no stop, so
/// that each wait of the handler can race it.
async fn stopped(stop: &Option<CancellationToken>) {
    match stop {
        Some(stop) => stop.cancelled().await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests;
