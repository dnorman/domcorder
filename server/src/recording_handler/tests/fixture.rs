//! What the tests of the recording handler run it with: the handler behind a local WebSocket
//! endpoint, hooks that report what the handler calls them with, and a page's frames and socket.

use crate::asset_cache::local::LocalBinaryStore;
use crate::asset_cache::sqlite::SqliteMetadataStore;
use crate::asset_cache::{AssetMetadata, AssetUsageParams};
use crate::recording_handler::{RecordingConfig, RecordingHooks, handle_websocket_recording};
use crate::{AppState, StorageState};
use axum::Router;
use axum::extract::WebSocketUpgrade;
use axum::routing::get;
use domcorder_proto::{
    AssetData, AssetFetchError, Frame, FrameReader, FrameWriter, RecordingMetadataData,
    TimestampData,
};
use futures_util::{SinkExt, StreamExt};
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tempfile::TempDir;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, mpsc};
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message as PageMessage;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;

/// The file the handler under test records into.
pub(super) const RECORDING: &str = "recording.dcrr";

/// The largest recording the handler under test accepts.
pub(super) const MAX_SIZE: usize = 1024 * 1024;

/// How long a test waits for something the handler must do, generous for a loaded machine.
pub(super) const PATIENCE: Duration = Duration::from_secs(10);

/// More bytes than the socket's buffers hold when the page does not read it.
pub(super) const MORE_THAN_THE_SOCKET_HOLDS: usize = 12 * 1024 * 1024;

type PageSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// What the handler under test reports, in the order it happens.
#[derive(Debug, PartialEq)]
pub(super) enum Reported {
    /// `on_start` returned.
    Started,
    /// `on_metadata` was called.
    Metadata,
    Completed {
        saved: String,
        bytes: usize,
    },
    Failed(String),
    /// The handler returned.
    Ended,
}

/// What the handler's `on_start` hook does.
#[derive(Clone)]
pub(super) enum OnStart {
    /// Names the recording.
    Names,
    /// Names the recording once the test lets it return.
    Held(Arc<HeldHook>),
    /// Fails with this error.
    FailsWith(String),
    /// Fails with this error once the test lets it return.
    HeldThenFails(Arc<HeldHook>, String),
}

/// What the handler's `on_error` hook does once it has reported the error.
#[derive(Clone)]
pub(super) enum OnError {
    /// Returns.
    Returns,
    /// Returns once the test lets it.
    Held(Arc<HeldHook>),
}

/// Holds a hook of the handler's until the test lets it return.
#[derive(Default)]
pub(super) struct HeldHook {
    pub(super) running: Notify,
    pub(super) released: Notify,
    /// Set while the hook waits to be let go, and cleared when it returns or is dropped.
    held: AtomicBool,
}

impl HeldHook {
    /// Holds the hook that awaits it until the test lets it go.
    async fn hold(&self) {
        self.held.store(true, Ordering::SeqCst);
        let _cleared_as_the_hook_ends = ClearedOnDrop(&self.held);
        self.running.notify_one();
        self.released.notified().await;
    }

    /// Whether the hook is still waiting to be let go.
    pub(super) fn is_held(&self) -> bool {
        self.held.load(Ordering::SeqCst)
    }
}

/// Clears its flag when dropped, as the future that holds it is when it returns or is dropped.
struct ClearedOnDrop<'a>(&'a AtomicBool);

impl Drop for ClearedOnDrop<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// One recording handler behind a local WebSocket endpoint, and what it reports.
pub(super) struct Endpoint {
    address: SocketAddr,
    pub(super) state: AppState,
    pub(super) reports: mpsc::UnboundedReceiver<Reported>,
    _storage: TempDir,
}

impl Endpoint {
    /// Serves the handler on a local port, configured with `stop`.
    pub(super) async fn start(stop: Option<CancellationToken>) -> Self {
        Self::start_with(stop, OnStart::Names, OnError::Returns).await
    }

    /// Serves the handler on a local port, configured with `stop`, with `on_start` and
    /// `on_error` hooks that do what `on_start` and `on_error` say.
    pub(super) async fn start_with(
        stop: Option<CancellationToken>,
        on_start: OnStart,
        on_error: OnError,
    ) -> Self {
        let storage = tempfile::tempdir().unwrap();
        let metadata_store =
            Box::new(SqliteMetadataStore::new(storage.path().join("asset_cache.db")).unwrap());
        let asset_file_store = Box::new(
            LocalBinaryStore::new(
                storage.path().join("assets"),
                "http://test.example".to_string(),
            )
            .unwrap(),
        );
        let state: AppState = Arc::new(StorageState::new(
            storage.path().to_path_buf(),
            metadata_store,
            asset_file_store,
        ));
        let (report, reports) = mpsc::unbounded_channel();

        let handler_state = state.clone();
        let app = Router::new().route(
            "/record",
            get(move |ws: WebSocketUpgrade| {
                let (state, stop, report, on_start, on_error) = (
                    handler_state.clone(),
                    stop.clone(),
                    report.clone(),
                    on_start.clone(),
                    on_error.clone(),
                );
                async move {
                    ws.on_upgrade(move |socket| async move {
                        let config = RecordingConfig {
                            max_size: MAX_SIZE,
                            subdir: None,
                            custom_filename: None,
                            stop,
                        };
                        let hooks = hooks_reporting_to(&report, on_start, on_error);
                        handle_websocket_recording(socket, state, None, config, hooks).await;
                        let _ = report.send(Reported::Ended);
                    })
                }
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        Self {
            address,
            state,
            reports,
            _storage: storage,
        }
    }

    /// Opens a page's recording socket to the handler.
    pub(super) async fn connect(&self) -> PageSocket {
        let (page, _) = tokio_tungstenite::connect_async(format!("ws://{}/record", self.address))
            .await
            .unwrap();
        page
    }

    /// Caches enough assets for the page of `metadata()` that its cache manifest, over 12 MiB,
    /// fills the socket's buffers when the page does not read it.
    pub(super) async fn fill_the_cache_manifest(&self) {
        let hash = "0".repeat(64);
        let store = &self.state.metadata_store;
        store
            .store_asset_metadata(AssetMetadata {
                sha256_hash: hash.clone(),
                random_id: "1".repeat(32),
                size: 1,
                mime_type: "image/png".to_string(),
            })
            .await
            .unwrap();
        for asset in 0..200 {
            store
                .register_asset_usage(AssetUsageParams {
                    site_origin: "https://example.com".to_string(),
                    url: format!("https://example.com/{asset}/{}", "a".repeat(64 * 1024)),
                    sha256_hash: hash.clone(),
                    size: 1,
                })
                .await
                .unwrap();
        }
    }

    /// Waits until the save has reached the Timestamp frame `timestamp`, and so has been given
    /// every frame before it.
    pub(super) async fn until_the_save_reaches(&self, timestamp: u64) {
        timeout(PATIENCE, async {
            while self.state.get_latest_timestamp(RECORDING) != Some(timestamp) {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the save never reached the timestamp");
    }

    /// Waits until the save has written the recording and ended.
    pub(super) async fn until_the_save_ends(&self) {
        timeout(PATIENCE, async {
            while !self.state.recording_exists(RECORDING)
                || self.state.is_recording_active(RECORDING)
            {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the save never ended");
    }

    /// Waits until the save has failed the recording.
    pub(super) async fn until_the_save_fails(&self) {
        let failed = format!("{RECORDING}.failed");
        timeout(PATIENCE, async {
            while !self.state.recording_exists(&failed) {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the save never failed");
    }

    /// The next thing the handler reports.
    pub(super) async fn next_report(&mut self) -> Reported {
        timeout(PATIENCE, self.reports.recv())
            .await
            .expect("the handler reported nothing")
            .expect("the handler's endpoint is gone")
    }

    /// What the handler reports, until it returns.
    pub(super) async fn reports_until_the_handler_ends(&mut self) -> Vec<Reported> {
        let mut reports = Vec::new();
        timeout(PATIENCE, async {
            while let Some(report) = self.reports.recv().await {
                let ended = report == Reported::Ended;
                reports.push(report);
                if ended {
                    return;
                }
            }
        })
        .await
        .expect("the handler did not end");
        reports
    }

    /// The frames of the stored recording, which must read whole.
    pub(super) async fn stored_frames(&self) -> Vec<Frame> {
        let stored = self
            .state
            .get_recording(RECORDING)
            .expect("no recording was stored");
        let mut reader = FrameReader::new(Cursor::new(stored), true);
        reader
            .read_header()
            .await
            .expect("the recording has no header");
        let mut frames = Vec::new();
        while let Some(frame) = reader
            .read_frame()
            .await
            .expect("the recording does not read whole")
        {
            frames.push(frame);
        }
        frames
    }
}

/// Hooks that send `report` what the handler calls them with, and `on_start` and `on_error` hooks
/// that do what `on_start` and `on_error` say.
fn hooks_reporting_to(
    report: &mpsc::UnboundedSender<Reported>,
    on_start: OnStart,
    on_error: OnError,
) -> RecordingHooks {
    let (started, metadata, completed, failed) = (
        report.clone(),
        report.clone(),
        report.clone(),
        report.clone(),
    );
    RecordingHooks {
        on_start: Some(Box::new(move || {
            let (started, on_start) = (started.clone(), on_start.clone());
            Box::pin(async move {
                let named = match on_start {
                    OnStart::Names => Ok(RECORDING.to_string()),
                    OnStart::Held(held_start) => {
                        held_start.hold().await;
                        Ok(RECORDING.to_string())
                    }
                    OnStart::FailsWith(error) => Err(error),
                    OnStart::HeldThenFails(held_start, error) => {
                        held_start.hold().await;
                        Err(error)
                    }
                };
                let _ = started.send(Reported::Started);
                named
            })
        })),
        on_metadata: Some(Box::new(move |_| {
            let _ = metadata.send(Reported::Metadata);
            Box::pin(async { Ok(None) })
        })),
        on_complete: Some(Box::new(move |saved, bytes| {
            let _ = completed.send(Reported::Completed {
                saved: saved.to_string(),
                bytes,
            });
            Box::pin(async {})
        })),
        on_error: Some(Box::new(move |error| {
            let _ = failed.send(Reported::Failed(error.to_string()));
            let on_error = on_error.clone();
            Box::pin(async move {
                if let OnError::Held(held_error) = on_error {
                    held_error.hold().await;
                }
            })
        })),
    }
}

pub(super) fn metadata() -> Frame {
    Frame::RecordingMetadata(RecordingMetadataData {
        initial_url: "https://example.com/page".to_string(),
        heartbeat_interval_seconds: 0,
    })
}

pub(super) fn timestamp(timestamp: u64) -> Frame {
    Frame::Timestamp(TimestampData { timestamp })
}

/// An asset the page could not fetch itself, which the save fetches from `url` before it reads
/// on.
pub(super) fn unfetched_asset(url: &str) -> Frame {
    Frame::Asset(AssetData {
        asset_id: 1,
        url: url.to_string(),
        mime: None,
        buf: Vec::new(),
        fetch_error: AssetFetchError::Network,
    })
}

/// Frames encoded as the page sends them, in one message.
pub(super) fn encoded(frames: &[Frame]) -> Vec<u8> {
    let mut writer = FrameWriter::new(Vec::new());
    for frame in frames {
        writer.write_frame(frame).unwrap();
    }
    writer.into_inner()
}

/// The bytes of messages that each hold one of `frames`.
pub(super) fn bytes_of(frames: &[Frame]) -> usize {
    frames
        .iter()
        .map(|frame| encoded(std::slice::from_ref(frame)).len())
        .sum()
}

/// Sends `frame` as the page does: one frame to a message.
pub(super) async fn send(page: &mut PageSocket, frame: &Frame) {
    page.send(PageMessage::Binary(
        encoded(std::slice::from_ref(frame)).into(),
    ))
    .await
    .unwrap();
}

/// Reads the page's socket until the handler's close frame, and returns the messages before it.
pub(super) async fn until_closed_by_the_handler(page: &mut PageSocket) -> Vec<PageMessage> {
    timeout(PATIENCE, async {
        let mut messages = Vec::new();
        loop {
            match page.next().await {
                Some(Ok(PageMessage::Close(_))) => return messages,
                Some(Ok(message)) => messages.push(message),
                Some(Err(e)) => panic!("the page's socket failed before a close frame: {e}"),
                None => panic!("the page's socket ended without a close frame"),
            }
        }
    })
    .await
    .expect("the handler sent no close frame")
}

/// Waits until the handler has begun to write to the page's socket, which the page does not read.
pub(super) async fn until_the_handler_writes_to(page: &PageSocket) {
    let MaybeTlsStream::Plain(socket) = page.get_ref() else {
        unreachable!("the page connects without TLS")
    };
    let mut first_byte = [0];
    let written = timeout(PATIENCE, socket.peek(&mut first_byte))
        .await
        .expect("the handler wrote nothing to the page")
        .unwrap();
    assert_eq!(written, 1, "the handler closed the socket without writing to it");
}

/// The whole messages the page can still read from its socket, once the handler has let go of it.
pub(super) async fn whole_messages_left_for(page: &mut PageSocket) -> Vec<PageMessage> {
    timeout(PATIENCE, async {
        let mut messages = Vec::new();
        while let Some(Ok(message)) = page.next().await {
            messages.push(message);
        }
        messages
    })
    .await
    .expect("the page's socket never ended")
}
