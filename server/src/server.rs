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
use futures::TryStreamExt;
use futures_util::{SinkExt, StreamExt};
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
) -> impl IntoResponse {
    info!("📡 WebSocket upgrade request for /ws/record");
    ws.on_upgrade(move |socket| handle_websocket_stream(socket, state))
}

async fn handle_websocket_stream(socket: WebSocket, state: AppState) {
    info!("🔌 WebSocket connection established for recording");

    let (mut sender, mut receiver) = socket.split();

    // Send a welcome message
    if let Err(e) = sender
        .send(Message::Text(
            "Connected to domcorder recording stream".into(),
        ))
        .await
    {
        error!("Failed to send welcome message: {}", e);
        return;
    }

    // Create a pipe to stream WebSocket data to the existing save method
    let (pipe_writer, pipe_reader) = tokio::io::duplex(8192); // Back to reasonable buffer size
    let mut pipe_writer = pipe_writer;
    let pipe_reader = pipe_reader;

    // Spawn a task to handle the streaming save
    let state_clone = state.clone();
    let save_task = tokio::spawn(async move {
        state_clone
            .save_recording_stream_raw(pipe_reader, None)
            .await
    });

    let mut total_bytes = 0;
    let mut last_frame_time: Option<u128> = None;
    const MAX_RECORDING_SIZE: usize = 100 * 1024 * 1024; // 100MB limit

    // Process WebSocket messages and stream to pipe
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis();

                let time_since_last = match last_frame_time {
                    Some(last) => format!("(+{}ms)", now - last),
                    None => "(first frame)".to_string(),
                };

                info!(
                    "📦 [{}ms] {} Received {} bytes of binary data (total: {} bytes)",
                    now,
                    time_since_last,
                    data.len(),
                    total_bytes + data.len()
                );

                last_frame_time = Some(now);
                total_bytes += data.len();

                // Safety check: prevent runaway recordings
                if total_bytes > MAX_RECORDING_SIZE {
                    let error_msg =
                        format!("Recording too large ({} bytes), stopping", total_bytes);
                    error!("❌ {}", error_msg);
                    if let Err(e) = sender.send(Message::Text(error_msg.into())).await {
                        error!("Failed to send error message: {}", e);
                    }
                    break;
                }

                // Write data to the pipe (streams to disk immediately)
                if let Err(e) = pipe_writer.write_all(&data).await {
                    let error_msg = format!("Failed to write to pipe: {}", e);
                    error!("❌ {}", error_msg);
                    if let Err(e) = sender.send(Message::Text(error_msg.into())).await {
                        error!("Failed to send error message: {}", e);
                    }
                    break;
                }

                // Send periodic acknowledgments (every 100KB)
                if total_bytes % 102400 == 0 {
                    let ack_msg = format!("Streamed {} KB to disk", total_bytes / 1024);
                    info!("💾 {}", ack_msg);
                    if let Err(e) = sender.send(Message::Text(ack_msg.into())).await {
                        error!("Failed to send acknowledgment: {}", e);
                        break;
                    }
                }
            }
            Ok(Message::Text(text)) => {
                info!("📝 Received text message: {}", text);
                // No special handling needed - streaming happens automatically
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
            let response = format!("Recording saved as {} ({} bytes)", filename, total_bytes);
            info!("✅ {}", response);
            if let Err(e) = sender.send(Message::Text(response.into())).await {
                error!("Failed to send success message: {}", e);
            }
        }
        Ok(Err(e)) => {
            let error_msg = format!("Failed to save recording: {}", e);
            error!("❌ {}", error_msg);
            if let Err(e) = sender.send(Message::Text(error_msg.into())).await {
                error!("Failed to send error message: {}", e);
            }
        }
        Err(e) => {
            let error_msg = format!("Save task panicked: {}", e);
            error!("❌ {}", error_msg);
            if let Err(e) = sender.send(Message::Text(error_msg.into())).await {
                error!("Failed to send error message: {}", e);
            }
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
    match state.list_recordings() {
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

    match state.get_recording_stream(&filename).await {
        Ok(stream) => {
            // Convert the AsyncRead into a stream of bytes
            let stream = ReaderStream::new(stream);
            let body = axum::body::Body::from_stream(stream);

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
