use domcorder_proto::{Frame, FrameReader};
use std::collections::HashMap;
use std::env;
use tokio::fs::File;
use tokio::io::BufReader;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: dcrr-inspect <file>");
        std::process::exit(1);
    }
    let path = &args[1];

    let file = File::open(path).await.expect("Failed to open file");
    let reader = BufReader::new(file);

    // Peek at first 4 bytes to detect DCRR header
    let mut peek_buf = [0u8; 4];
    let peek_file = File::open(path).await.expect("Failed to open file");
    let mut peek_reader = BufReader::new(peek_file);
    use tokio::io::AsyncReadExt;
    let _ = peek_reader.read_exact(&mut peek_buf).await;
    let has_header = &peek_buf == b"DCRR";

    let mut frame_reader = FrameReader::new(reader, has_header);

    if has_header {
        let header = frame_reader.read_header().await.expect("Failed to read header");
        let created_ms = header.created_at;
        let created = chrono::DateTime::from_timestamp_millis(created_ms as i64)
            .map(|dt| dt.to_string())
            .unwrap_or_else(|| format!("{}ms", created_ms));
        println!("DCRR v{} created {}", header.version, created);
    } else {
        println!("Raw frame stream (no DCRR header)");
    }
    println!();

    let mut frame_num = 0u64;
    let mut counts: HashMap<String, u64> = HashMap::new();
    let mut last_timestamp: Option<u64> = None;

    loop {
        match frame_reader.read_frame().await {
            Ok(Some(frame)) => {
                let name = frame_type_name(&frame);
                *counts.entry(name.clone()).or_default() += 1;

                let detail = frame_detail(&frame);
                if let Frame::Timestamp(ts) = &frame {
                    last_timestamp = Some(ts.timestamp);
                }
                let ts_str = last_timestamp
                    .map(|t| format!(" @{}ms", t))
                    .unwrap_or_default();
                if detail.is_empty() {
                    println!("  #{:<5} {}{}", frame_num, name, ts_str);
                } else {
                    println!("  #{:<5} {}{} — {}", frame_num, name, ts_str, detail);
                }
                frame_num += 1;
            }
            Ok(None) => break,
            Err(e) => {
                eprintln!("Error reading frame #{}: {}", frame_num, e);
                break;
            }
        }
    }

    println!();
    println!("Total frames: {}", frame_num);
    println!();
    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    for (name, count) in &sorted {
        println!("  {:<30} {}", name, count);
    }
}

fn frame_type_name(frame: &Frame) -> String {
    match frame {
        Frame::Timestamp(_) => "Timestamp",
        Frame::Keyframe(_) => "Keyframe",
        Frame::ViewportResized(_) => "ViewportResized",
        Frame::ScrollOffsetChanged(_) => "ScrollOffsetChanged",
        Frame::MouseMoved(_) => "MouseMoved",
        Frame::MouseClicked(_) => "MouseClicked",
        Frame::KeyPressed(_) => "KeyPressed",
        Frame::ElementFocused(_) => "ElementFocused",
        Frame::TextSelectionChanged(_) => "TextSelectionChanged",
        Frame::DomNodeAdded(_) => "DomNodeAdded",
        Frame::DomNodeRemoved(_) => "DomNodeRemoved",
        Frame::DomAttributeChanged(_) => "DomAttributeChanged",
        Frame::DomAttributeRemoved(_) => "DomAttributeRemoved",
        Frame::DomTextChanged(_) => "DomTextChanged",
        Frame::DomNodeResized(_) => "DomNodeResized",
        Frame::DomNodePropertyChanged(_) => "DomNodePropertyChanged",
        Frame::Asset(_) => "Asset",
        Frame::AdoptedStyleSheetsChanged(_) => "AdoptedStyleSheetsChanged",
        Frame::NewAdoptedStyleSheet(_) => "NewAdoptedStyleSheet",
        Frame::ElementScrolled(_) => "ElementScrolled",
        Frame::ElementBlurred(_) => "ElementBlurred",
        Frame::WindowFocused(_) => "WindowFocused",
        Frame::WindowBlurred(_) => "WindowBlurred",
        Frame::StyleSheetRuleInserted(_) => "StyleSheetRuleInserted",
        Frame::StyleSheetRuleDeleted(_) => "StyleSheetRuleDeleted",
        Frame::StyleSheetReplaced(_) => "StyleSheetReplaced",
        Frame::CanvasChanged(_) => "CanvasChanged",
        Frame::DomNodePropertyTextChanged(_) => "DomNodePropertyTextChanged",
        Frame::RecordingMetadata(_) => "RecordingMetadata",
        Frame::AssetReference(_) => "AssetReference",
        Frame::CacheManifest(_) => "CacheManifest",
        Frame::PlaybackConfig(_) => "PlaybackConfig",
        Frame::Heartbeat => "Heartbeat",
    }
    .to_string()
}

fn frame_detail(frame: &Frame) -> String {
    match frame {
        Frame::Timestamp(d) => format!("t={}", d.timestamp),
        Frame::Keyframe(d) => format!("{}x{}", d.viewport_width, d.viewport_height),
        Frame::ViewportResized(d) => format!("{}x{}", d.width, d.height),
        Frame::MouseMoved(d) => format!("({}, {})", d.x, d.y),
        Frame::MouseClicked(d) => format!("({}, {})", d.x, d.y),
        Frame::RecordingMetadata(d) => {
            format!("url={} heartbeat={}s", d.initial_url, d.heartbeat_interval_seconds)
        }
        Frame::AssetReference(d) => format!("id={} url={}", d.asset_id, d.url),
        Frame::DomNodeAdded(d) => format!("parent={} idx={}", d.parent_node_id, d.index),
        Frame::DomNodeRemoved(d) => format!("node={}", d.node_id),
        Frame::DomAttributeChanged(d) => format!("node={} {}=...", d.node_id, d.attribute_name),
        Frame::DomTextChanged(d) => format!("node={}", d.node_id),
        Frame::ElementScrolled(d) => format!("node={} ({},{})", d.node_id, d.scroll_x_offset, d.scroll_y_offset),
        Frame::PlaybackConfig(d) => format!("storage={} live={}", d.storage_type, d.is_live),
        _ => String::new(),
    }
}
