use crate::recording_handler::{handle_websocket_recording, RecordingConfig, RecordingHooks};
use crate::AppState;
use axum::{
    Router,
    body::Body,
    extract::{Path, State, WebSocketUpgrade},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use domcorder_proto::{Frame, FrameWriter, PlaybackConfigData};
use futures::TryStreamExt;
use futures::stream;
use futures_util::StreamExt;
use serde_json;
use std::io::Cursor;

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
    
    ws.on_upgrade(move |socket| {
        handle_websocket_recording(
            socket,
            state,
            user_agent,
            RecordingConfig {
                max_size: 100 * 1024 * 1024, // 100MB
                subdir: None,
                custom_filename: None,
            },
            RecordingHooks {
                on_start: None,
                on_metadata: None,
                on_complete: None,
                on_error: None,
            },
        )
    })
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
    
    // Check if recording is live and get latest timestamp
    let is_live = state.is_recording_active(&filename);
    let latest_timestamp = if is_live {
        state.get_latest_timestamp(&filename)
    } else {
        None
    };
    
    let playback_config = Frame::PlaybackConfig(PlaybackConfigData {
        storage_type,
        config_json,
        is_live,
        latest_timestamp,
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
