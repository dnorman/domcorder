use crate::AppState;
use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures::TryStreamExt;
use tokio_util::io::StreamReader;

pub fn create_app(state: AppState) -> Router {
    Router::new()
        .route("/record", post(handle_record))
        .route("/recordings", get(handle_list_recordings))
        .route("/recording/{filename}", get(handle_get_recording))
        .with_state(state)
}

async fn handle_record(State(state): State<AppState>, body: Body) -> impl IntoResponse {
    // Convert the axum Body to a stream of bytes, then to an AsyncRead
    let stream = body
        .into_data_stream()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));
    let async_reader = StreamReader::new(stream);

    // Stream the data through our frame reader/writer pipeline (frames only, no header)
    match state.save_recording_stream_frames_only(async_reader).await {
        Ok(filename) => {
            (StatusCode::OK, format!("Recording saved as {}", filename)).into_response()
        }
        Err(e) => {
            eprintln!("Failed to save recording: {}", e);
            (
                StatusCode::BAD_REQUEST,
                format!("Failed to process recording: {}", e),
            )
                .into_response()
        }
    }
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

    match state.get_recording(&filename) {
        Ok(data) => {
            // Skip the 32-byte DCRR header
            if data.len() < 32 {
                return (StatusCode::BAD_REQUEST, "Invalid recording file").into_response();
            }

            let frame_data = &data[32..];

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(axum::body::Body::from(frame_data.to_vec()))
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
