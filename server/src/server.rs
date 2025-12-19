use crate::asset_cache::manifest::generate_manifest;
use crate::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::{
    Router,
    body::Body,
    extract::{Path, State, WebSocketUpgrade},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use domcorder_proto::{Frame, FrameReader, FrameWriter, CacheManifestData, ManifestEntryData, PlaybackConfigData};
use std::io::Cursor;
use futures::TryStreamExt;
use futures_util::{SinkExt, StreamExt};
use futures::stream;
use serde_json;
use tokio::io::AsyncWriteExt;

use tokio_util::io::{ReaderStream, StreamReader};
use tower_http::cors::CorsLayer;
use tracing::{debug, error, info, warn};

pub fn create_app(state: AppState) -> Router {
    Router::new()
        .route("/record", post(handle_record).options(handle_options))
        .route("/ws/record", get(handle_websocket_record))
        .route("/recordings", get(handle_list_recordings))
        .route("/recording/{filename}", get(handle_get_recording))
        .route("/assets/{hash}", get(handle_get_asset))
        .layer(CorsLayer::permissive()) // Allow CORS for all origins during development
        .with_state(state)
}

async fn handle_record(State(state): State<AppState>, body: Body) -> impl IntoResponse {
    info!("📡 Received POST /record request");
    debug!("Request body type: {:?}", std::any::type_name::<Body>());

    // Convert the axum Body to a stream of bytes, then to an AsyncRead
    let stream = body.into_data_stream().map_err(|e| {
        warn!("Error converting body to data stream: {}", e);
        std::io::Error::new(std::io::ErrorKind::Other, e)
    });
    let async_reader = StreamReader::new(stream);
    debug!("Created StreamReader from body");

    // Stream the data through our frame reader/writer pipeline (frames only, no header)
    info!("Starting to process streaming data...");
    match state.save_recording_stream_frames_only(async_reader).await {
        Ok(filename) => {
            info!("✅ Successfully saved recording: {}", filename);
            (StatusCode::OK, format!("Recording saved as {}", filename)).into_response()
        }
        Err(e) => {
            error!("❌ Failed to save recording: {}", e);
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to process recording: {}", e),
            )
                .into_response()
        }
    }
}

async fn handle_websocket_record(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    info!("📡 WebSocket upgrade request for /ws/record");
    
    // Extract User-Agent from headers
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());
    
    if let Some(ua) = &user_agent {
        debug!("User-Agent: {}", ua);
    }
    
    ws.on_upgrade(move |socket| handle_websocket_stream(socket, state, user_agent))
}

async fn handle_websocket_stream(socket: WebSocket, state: AppState, user_agent: Option<String>) {
    info!("🔌 WebSocket connection established for recording");

    let (mut sender, mut receiver) = socket.split();

    // Wait for RecordingMetadata frame to get initial_url
    let mut site_origin: Option<String> = None;
    
    // Buffer for initial frames until we get metadata
    let mut frame_buffer = Vec::new();
    
    // Read initial frames to find RecordingMetadata
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                frame_buffer.push(data);
                
                // Try to parse frames from the buffer to find RecordingMetadata
                // We'll use a simple approach: try to parse the first frame
                if !frame_buffer.is_empty() && site_origin.is_none() {
                        // Try to parse the first frame from the accumulated buffer
                        let combined = frame_buffer.concat();
                        let cursor = std::io::Cursor::new(combined);
                        let mut reader = FrameReader::new(cursor, false);
                    
                    if let Some(Ok(frame)) = reader.next().await {
                        if let Frame::RecordingMetadata(metadata) = frame {
                            info!("📋 Received RecordingMetadata: initial_url={}", metadata.initial_url);
                            
                            // Register recording and extract site origin
                            let filename = state.generate_filename();
                            match state.metadata_store.register_recording(&filename, &metadata.initial_url).await {
                                Ok(site_info) => {
                                    site_origin = Some(site_info.origin.clone());
                                    
                                    // Generate and send cache manifest as a binary frame
                                    match generate_manifest(state.metadata_store.as_ref(), &site_info.origin, None).await {
                                        Ok(manifest) => {
                                            info!("📦 Sending cache manifest with {} entries", manifest.assets.len());
                                            
                                            // Convert manifest to frame data
                                            let manifest_entries: Vec<ManifestEntryData> = manifest.assets
                                                .iter()
                                                .map(|e| ManifestEntryData {
                                                    url: e.url.clone(),
                                                    sha256_hash: e.sha256_hash.clone(), // Manifest still uses SHA-256
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
                                            
                                            // Send as binary message (convert Vec<u8> to Bytes)
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
                error!("WebSocket error while waiting for metadata: {}", e);
                return;
            }
            _ => {}
        }
    }

    // Create a pipe to stream WebSocket data to the existing save method
    let (pipe_writer, pipe_reader) = tokio::io::duplex(8192);
    let mut pipe_writer = pipe_writer;
    let pipe_reader = pipe_reader;

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
    let state_clone = state.clone();
    let site_origin_clone = site_origin.clone();
    let user_agent_clone = user_agent.clone();
    let save_task = tokio::spawn(async move {
        state_clone
            .save_recording_stream_frames_only_with_site(
                pipe_reader, 
                site_origin_clone.as_deref(),
                user_agent_clone.as_deref(),
            )
            .await
    });
    // let mut last_frame_time: Option<u128> = None;
    const MAX_RECORDING_SIZE: usize = 100 * 1024 * 1024; // 100MB limit

    // Process remaining WebSocket messages and stream to pipe
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {


                // last_frame_time = Some(now);
                total_bytes += data.len();

                // Safety check: prevent runaway recordings
                if total_bytes > MAX_RECORDING_SIZE {
                    let error_msg = format!("Recording too large ({} bytes)", total_bytes);
                    error!("❌ {}", error_msg);
                    let _ = sender.close().await;
                    return;
                }

                // Write data to the pipe (streams to disk immediately)
                if let Err(e) = pipe_writer.write_all(&data).await {
                    let error_msg = format!("Failed to write to pipe: {}", e);
                    error!("❌ {}", error_msg);
                    let _ = sender.close().await;
                    return;
                }
            }
            Ok(Message::Text(_)) => {
                // Ignore text messages - protocol uses binary frames only
                warn!("Received unexpected text message, ignoring");
            }
            Ok(Message::Close(_)) => {
                info!("🔌 WebSocket connection closed, finalizing recording");
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {
                debug!("Received other message type");
            }
        }
    }

    // Close the pipe writer to signal end of stream
    info!(
        "🔌 Closing pipe writer, total bytes processed: {}",
        total_bytes
    );
    drop(pipe_writer);

    // Wait for the save task to complete
    match save_task.await {
        Ok(Ok(filename)) => {
            info!("✅ Recording saved as {} ({} bytes)", filename, total_bytes);
            // Close WebSocket normally on success
            let _ = sender.close().await;
        }
        Ok(Err(e)) => {
            let error_msg = format!("Failed to save recording: {}", e);
            error!("❌ {}", error_msg);
            // Close WebSocket with error
            let _ = sender.close().await;
        }
        Err(e) => {
            let error_msg = format!("Save task panicked: {}", e);
            error!("❌ {}", error_msg);
            // Close WebSocket with error
            let _ = sender.close().await;
        }
    }

    info!("🔌 WebSocket connection ended");
}

async fn handle_options() -> impl IntoResponse {
    info!("📡 Received OPTIONS /record request (CORS preflight)");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "POST, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "content-type")
        .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
        .body(axum::body::Body::empty())
        .unwrap()
}

async fn handle_list_recordings(State(state): State<AppState>) -> impl IntoResponse {
    match state.list_recordings(None) {
        Ok(recordings) => {
            let json = serde_json::to_string(&recordings).unwrap_or_else(|_| "[]".to_string());

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(axum::body::Body::from(json))
                .unwrap()
                .into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list recordings",
        )
            .into_response(),
    }
}

async fn handle_get_recording(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> impl IntoResponse {
    if !state.recording_exists(&filename) {
        return (StatusCode::NOT_FOUND, "Recording not found").into_response();
    }

    // Generate PlaybackConfig frame before moving state
    let storage_type = state.asset_file_store.storage_type().to_string();
    let config_json = match state.asset_file_store.config_json() {
        Ok(json) => json,
        Err(e) => {
            warn!("Failed to generate config_json: {}", e);
            serde_json::json!({}).to_string()
        }
    };
    
    let playback_config = Frame::PlaybackConfig(PlaybackConfigData {
        storage_type,
        config_json,
    });
    
    match state.get_recording_stream(&filename).await {
        Ok(recording_stream) => {
            // Encode PlaybackConfig frame to bytes
            let mut config_buffer = Vec::new();
            let mut config_writer = FrameWriter::new(Cursor::new(&mut config_buffer));
            if let Err(e) = config_writer.write_frame(&playback_config) {
                error!("Failed to encode PlaybackConfig frame: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to generate playback config").into_response();
            }
            drop(config_writer);
            
            // Create a stream that first yields the PlaybackConfig frame, then the recording
            let config_stream = stream::once(async move { Ok::<_, std::io::Error>(config_buffer.into()) });
            let recording_bytes = ReaderStream::new(recording_stream);
            let combined_stream = config_stream.chain(recording_bytes.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
            
            let body = axum::body::Body::from_stream(combined_stream);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "no-cache") // Prevent caching for live streams
                .body(body)
                .unwrap()
                .into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read recording",
        )
            .into_response(),
    }
}

async fn handle_get_asset(
    State(state): State<AppState>,
    Path(random_id): Path<String>,
) -> impl IntoResponse {
    // Resolve random_id to SHA-256 (storage key)
    let sha256 = match state.metadata_store.resolve_random_id(&random_id).await {
        Ok(Some(sha256)) => sha256,
        Ok(None) => return (StatusCode::NOT_FOUND, "Asset not found").into_response(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response(),
    };
    
    // Get asset data using SHA-256 (CAS key)
    let data = match state.asset_file_store.get(&sha256).await {
        Ok(data) => data,
        Err(_) => return (StatusCode::NOT_FOUND, "Asset not found").into_response(),
    };

    // Get MIME type from metadata using random_id
    let mime = match state.metadata_store.get_asset_metadata(&random_id).await {
        Ok(Some((mime_type, _))) => mime_type,
        Ok(None) | Err(_) => "application/octet-stream".to_string(),
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(axum::body::Body::from(data))
        .unwrap()
        .into_response()
}
