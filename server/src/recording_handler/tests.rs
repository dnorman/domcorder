//! The recording handler, run as a server runs it: an axum endpoint on a local port runs
//! `handle_websocket_recording`, and a WebSocket client stands in for the page.

mod fixture;

use crate::captured_logs::CapturedLogs;
use domcorder_proto::{AssetData, AssetFetchError, Frame, RecordingMetadataData};
use fixture::*;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message as PageMessage;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn a_stop_before_the_metadata_frame_closes_the_socket_and_makes_no_recording() {
    let stop = CancellationToken::new();
    let mut endpoint = Endpoint::start(Some(stop.clone())).await;
    let mut page = endpoint.connect().await;

    stop.cancel();

    until_closed_by_the_handler(&mut page).await;
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![Reported::Ended]
    );
    assert!(
        endpoint.state.list_recordings(None).unwrap().is_empty(),
        "a recording was made"
    );
}

#[tokio::test]
async fn a_stop_while_on_start_runs_waits_for_it_and_records_the_messages_read_before_it() {
    let stop = CancellationToken::new();
    let held_start = Arc::new(HeldHook::default());
    let mut endpoint = Endpoint::start_with(
        Some(stop.clone()),
        OnStart::Held(held_start.clone()),
        OnError::Returns,
    )
    .await;
    let mut page = endpoint.connect().await;
    // The handler reads the first message for its metadata frame, and no further until it has
    // set the recording up
    let read = [metadata(), timestamp(1)];
    page.send(PageMessage::Binary(encoded(&read).into()))
        .await
        .unwrap();
    send(&mut page, &timestamp(2)).await;
    timeout(PATIENCE, held_start.running.notified())
        .await
        .expect("on_start was never called");

    stop.cancel();
    // The test's runtime runs on one thread, where a yield lets each task the stop woke run
    // first: a handler that raced on_start against the stop would drop it here
    tokio::task::yield_now().await;
    assert!(held_start.is_held(), "the handler dropped on_start");
    assert!(
        endpoint.reports.is_empty(),
        "the handler reported before on_start returned"
    );
    held_start.released.notify_one();

    assert!(
        until_closed_by_the_handler(&mut page).await.is_empty(),
        "the stopped recording sent its cache manifest"
    );
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Completed {
                saved: RECORDING.to_string(),
                bytes: encoded(&read).len()
            },
            Reported::Ended,
        ]
    );
    assert_eq!(endpoint.stored_frames().await, read);
}

#[tokio::test]
async fn a_stop_while_on_start_runs_keeps_why_it_failed_from_the_page() {
    let stop = CancellationToken::new();
    let held_start = Arc::new(HeldHook::default());
    let why = "no session".to_string();
    let mut endpoint = Endpoint::start_with(
        Some(stop.clone()),
        OnStart::HeldThenFails(held_start.clone(), why),
        OnError::Returns,
    )
    .await;
    let mut page = endpoint.connect().await;
    send(&mut page, &metadata()).await;
    timeout(PATIENCE, held_start.running.notified())
        .await
        .expect("on_start was never called");

    stop.cancel();
    held_start.released.notify_one();

    assert!(
        until_closed_by_the_handler(&mut page).await.is_empty(),
        "the page got why on_start failed"
    );
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![Reported::Started, Reported::Ended]
    );
}

#[tokio::test]
async fn a_stop_while_the_page_does_not_read_why_on_start_failed_ends_without_waiting_for_the_page()
{
    let stop = CancellationToken::new();
    let error = "e".repeat(MORE_THAN_THE_SOCKET_HOLDS);
    let mut endpoint = Endpoint::start_with(
        Some(stop.clone()),
        OnStart::FailsWith(error),
        OnError::Returns,
    )
    .await;
    // A page that sends its metadata frame and never reads its socket
    let mut page = endpoint.connect().await;
    send(&mut page, &metadata()).await;
    until_the_handler_writes_to(&page).await;

    stop.cancel();

    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![Reported::Started, Reported::Ended]
    );
    assert!(
        whole_messages_left_for(&mut page).await.is_empty(),
        "the page got the whole error"
    );
}

/// The test assumes that the save, of the metadata frame alone, ends within the 5 seconds the
/// handler waits for its close frame to be written, which the page keeps from finishing.
#[tokio::test]
async fn a_stop_while_the_page_does_not_read_the_cache_manifest_ends_without_waiting_for_the_page()
{
    let stop = CancellationToken::new();
    let mut endpoint = Endpoint::start(Some(stop.clone())).await;
    endpoint.fill_the_cache_manifest().await;
    // A page that sends its metadata frame and never reads its socket
    let mut page = endpoint.connect().await;
    send(&mut page, &metadata()).await;
    // The handler makes and sends the cache manifest right after it calls on_metadata
    assert_eq!(endpoint.next_report().await, Reported::Started);
    assert_eq!(endpoint.next_report().await, Reported::Metadata);
    until_the_handler_writes_to(&page).await;

    stop.cancel();

    // The save ends while the handler still waits to close the socket
    endpoint.until_the_save_ends().await;
    assert!(
        endpoint.reports.is_empty(),
        "the handler reported before its close of the socket ended"
    );
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Completed {
                saved: RECORDING.to_string(),
                bytes: bytes_of(&[metadata()])
            },
            Reported::Ended,
        ]
    );
    assert!(
        whole_messages_left_for(&mut page).await.is_empty(),
        "the page got the whole cache manifest"
    );
    assert_eq!(endpoint.stored_frames().await, [metadata()]);
}

#[tokio::test]
async fn a_stop_while_streaming_ends_a_whole_recording_with_what_the_save_was_given() {
    let stop = CancellationToken::new();
    let mut endpoint = Endpoint::start(Some(stop.clone())).await;
    let mut page = endpoint.connect().await;
    let given = [metadata(), timestamp(1), timestamp(2)];
    for frame in &given {
        send(&mut page, frame).await;
    }
    endpoint.until_the_save_reaches(2).await;

    stop.cancel();
    // A frame the page sends once the recording is stopped; the socket may already be closing.
    let _ = page
        .send(PageMessage::Binary(encoded(&[timestamp(3)]).into()))
        .await;

    until_closed_by_the_handler(&mut page).await;
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Completed {
                saved: RECORDING.to_string(),
                bytes: bytes_of(&given)
            },
            Reported::Ended,
        ]
    );
    assert_eq!(endpoint.stored_frames().await, given);
}

#[tokio::test]
async fn a_stop_while_the_save_is_behind_closes_the_socket_without_waiting_for_the_save() {
    // An asset server that takes the save's fetch and does not answer it until the test lets go
    let asset_server = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let held_asset = format!("http://{}/held.png", asset_server.local_addr().unwrap());
    let stop = CancellationToken::new();
    let mut endpoint = Endpoint::start(Some(stop.clone())).await;
    let mut page = endpoint.connect().await;
    let handed = [metadata(), unfetched_asset(&held_asset), timestamp(1)];
    for frame in &handed {
        send(&mut page, frame).await;
    }
    // The handler answers the ping in its next read of the socket, which returns timestamp 2
    page.send(PageMessage::Ping(Vec::new().into()))
        .await
        .unwrap();
    for t in 2..=3 {
        send(&mut page, &timestamp(t)).await;
    }
    let (held_fetch, _) = timeout(PATIENCE, asset_server.accept())
        .await
        .expect("the save never fetched the asset")
        .unwrap();
    // The save is held on the fetch and its input holds timestamp 1. Once the page has the pong,
    // the handler is waiting to hand the save timestamp 2.
    timeout(PATIENCE, async {
        while !matches!(page.next().await, Some(Ok(PageMessage::Pong(_)))) {}
    })
    .await
    .expect("the handler never answered the ping");

    stop.cancel();

    until_closed_by_the_handler(&mut page).await;
    drop(asset_server);
    drop(held_fetch);
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Completed {
                saved: RECORDING.to_string(),
                bytes: bytes_of(&handed)
            },
            Reported::Ended,
        ]
    );
    // The asset the save could not fetch is left out, as the save leaves out any such asset
    assert_eq!(endpoint.stored_frames().await, [metadata(), timestamp(1)]);
}

#[tokio::test]
async fn a_stop_that_comes_with_the_pages_close_and_twice_completes_the_recording_once() {
    let stop = CancellationToken::new();
    let mut endpoint = Endpoint::start(Some(stop.clone())).await;
    let mut page = endpoint.connect().await;
    let given = [metadata(), timestamp(1)];
    for frame in &given {
        send(&mut page, frame).await;
    }
    endpoint.until_the_save_reaches(1).await;

    page.close(None).await.unwrap();
    stop.cancel();
    stop.cancel();

    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Completed {
                saved: RECORDING.to_string(),
                bytes: bytes_of(&given)
            },
            Reported::Ended,
        ]
    );
    assert_eq!(endpoint.stored_frames().await, given);
}

#[tokio::test]
async fn a_recording_given_no_stop_ends_when_the_page_closes_the_socket() {
    let mut endpoint = Endpoint::start(None).await;
    let mut page = endpoint.connect().await;
    let given = [metadata(), timestamp(1)];
    for frame in &given {
        send(&mut page, frame).await;
    }
    endpoint.until_the_save_reaches(1).await;

    page.close(None).await.unwrap();

    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Completed {
                saved: RECORDING.to_string(),
                bytes: bytes_of(&given)
            },
            Reported::Ended,
        ]
    );
    assert_eq!(endpoint.stored_frames().await, given);
}

#[tokio::test]
async fn a_message_the_save_cannot_take_reports_what_the_save_failed_with() {
    let mut endpoint = Endpoint::start(None).await;
    let mut page = endpoint.connect().await;
    send(&mut page, &metadata()).await;
    // A frame one byte long, which no frame decodes from
    page.send(PageMessage::Binary(vec![0, 0, 0, 1, 0xff].into()))
        .await
        .unwrap();
    endpoint.until_the_save_fails().await;

    send(&mut page, &timestamp(1)).await;

    let reports = endpoint.reports_until_the_handler_ends().await;
    assert!(
        matches!(
            reports.as_slice(),
            [Reported::Started, Reported::Metadata, Reported::Failed(error), Reported::Ended]
                if error.starts_with("Failed to save recording: Failed to decode frame")
        ),
        "the save's own error was not reported: {reports:?}"
    );
}

#[tokio::test]
async fn a_save_that_cannot_make_its_file_reports_why() {
    let mut endpoint = Endpoint::start(None).await;
    // A directory where the save would make its file
    let recording_path = endpoint
        .state
        .storage_dir
        .join("recordings")
        .join(RECORDING);
    std::fs::create_dir_all(&recording_path).unwrap();
    // What the save's making of its file fails with
    let why = std::fs::File::create(&recording_path).unwrap_err();
    let mut page = endpoint.connect().await;
    // The metadata frame in two messages, which the handler hands to the save one after the
    // other, so that the second waits on a save that has ended
    let metadata = encoded(&[metadata()]);
    let (first, second) = metadata.split_at(metadata.len() / 2);
    for part in [first, second] {
        page.send(PageMessage::Binary(part.to_vec().into()))
            .await
            .unwrap();
    }

    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Failed(format!("Failed to save recording: {why}")),
            Reported::Ended,
        ]
    );
}

#[tokio::test]
async fn a_metadata_frame_over_the_size_limit_makes_no_recording() {
    let mut endpoint = Endpoint::start(None).await;
    let mut page = endpoint.connect().await;
    let too_large = Frame::RecordingMetadata(RecordingMetadataData {
        initial_url: format!("https://example.com/page?{}", "a".repeat(MAX_SIZE)),
        heartbeat_interval_seconds: 0,
    });

    send(&mut page, &too_large).await;

    until_closed_by_the_handler(&mut page).await;
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Failed(format!(
                "Recording too large ({} bytes)",
                bytes_of(&[too_large])
            )),
            Reported::Ended,
        ]
    );
    assert!(
        endpoint.state.list_recordings(None).unwrap().is_empty(),
        "a recording was made"
    );
}

#[tokio::test]
async fn a_message_past_the_size_limit_reports_the_size_and_lets_the_save_end_without_it() {
    let held_error = Arc::new(HeldHook::default());
    let mut endpoint =
        Endpoint::start_with(None, OnStart::Names, OnError::Held(held_error.clone())).await;
    let mut page = endpoint.connect().await;
    let given = [metadata(), timestamp(1)];
    for frame in &given {
        send(&mut page, frame).await;
    }
    endpoint.until_the_save_reaches(1).await;
    let too_large = Frame::Asset(AssetData {
        asset_id: 1,
        url: "https://example.com/large.png".to_string(),
        mime: Some("image/png".to_string()),
        buf: vec![0; MAX_SIZE],
        fetch_error: AssetFetchError::None,
    });

    send(&mut page, &too_large).await;

    // The save ends while on_error is held, so the handler, which returns only after on_error,
    // has let go of the save's input before it
    timeout(PATIENCE, held_error.running.notified())
        .await
        .expect("on_error was never called");
    endpoint.until_the_save_ends().await;
    assert_eq!(endpoint.stored_frames().await, given);
    held_error.released.notify_one();
    assert_eq!(
        endpoint.reports_until_the_handler_ends().await,
        vec![
            Reported::Started,
            Reported::Metadata,
            Reported::Failed(format!(
                "Recording too large ({} bytes)",
                bytes_of(&given) + bytes_of(&[too_large])
            )),
            Reported::Ended,
        ]
    );
}

#[tokio::test]
async fn the_metadata_line_shows_the_pages_address_without_its_user_info_query_or_fragment() {
    let (logs, _capturing) = CapturedLogs::start();
    let mut endpoint = Endpoint::start(None).await;
    let mut page = endpoint.connect().await;
    let metadata = Frame::RecordingMetadata(RecordingMetadataData {
        initial_url: "https://person:SECRET@example.com/sign-in?token=SECRET#SECRET".to_string(),
        heartbeat_interval_seconds: 0,
    });

    send(&mut page, &metadata).await;
    page.close(None).await.unwrap();
    endpoint.reports_until_the_handler_ends().await;

    logs.assert_shows("Received RecordingMetadata: initial_url=https://example.com/sign-in");
    logs.assert_never_shows("SECRET");
}
