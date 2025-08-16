
use domcorder_proto::*;
use std::fs;

mod common;
use common::sample_frames;

#[test]
fn read_sample_frame_stream() {
    // Read the TypeScript-generated frame stream (no header)
    let binary_data = fs::read("../.sample_data/proto/frames-basic.bin")
        .expect("Failed to read TypeScript-generated binary file");

    println!("Reading TypeScript-generated frame stream ({} bytes)...", binary_data.len());

    // Create stream reader (no header expected)
    let cursor = std::io::Cursor::new(binary_data);
    let mut reader = FrameReader::new(cursor);
    
    // Read all frames
    let mut parsed_frames: Vec<Frame> = Vec::new();
    while let Some(frame) = reader.read_frame().unwrap() {
        parsed_frames.push(frame);
    }

    println!("✓ Successfully parsed {} frames from TypeScript binary", parsed_frames.len());

    let expected_frames = sample_frames();
    
    // Assert that we parsed the expected number of frames
    assert_eq!(parsed_frames.len(), expected_frames.len(), 
        "Should parse {} frames, got {}", expected_frames.len(), parsed_frames.len());

    // Assert each frame matches expectations
    for (i, (parsed, expected)) in parsed_frames.iter().zip(expected_frames.iter()).enumerate() {
        assert_eq!(parsed, expected, "Frame {} should match expected frame", i);
    }

    println!("🎉 All {} frames match expected values!", parsed_frames.len());
}

#[test]
fn read_sample_file() {
    // Read the TypeScript-generated .dcrr file (header + frames)
    let binary_data = fs::read("../.sample_data/proto/file-basic.dcrr")
        .expect("Failed to read TypeScript-generated .dcrr file");

    println!("Reading TypeScript-generated .dcrr file ({} bytes)...", binary_data.len());

    // Create file reader (header expected)
    let cursor = std::io::Cursor::new(binary_data);
    let mut reader = FrameReader::new(cursor);
    
    // Read and validate header
    let header = reader.read_header().unwrap();
    assert_eq!(header.version, 1);
    println!("✓ Read header: version={}, timestamp={}", header.version, header.created_at);
    
    // Read all frames
    let mut parsed_frames: Vec<Frame> = Vec::new();
    while let Some(frame) = reader.read_frame().unwrap() {
        parsed_frames.push(frame);
    }

    println!("✓ Successfully parsed {} frames from .dcrr file", parsed_frames.len());

    let expected_frames = sample_frames();
    
    // Assert that we parsed the expected number of frames
    assert_eq!(parsed_frames.len(), expected_frames.len(), 
        "Should parse {} frames, got {}", expected_frames.len(), parsed_frames.len());

    // Assert each frame matches expectations
    for (i, (parsed, expected)) in parsed_frames.iter().zip(expected_frames.iter()).enumerate() {
        assert_eq!(parsed, expected, "Frame {} should match expected frame", i);
    }

    println!("🎉 All {} frames match expected values from .dcrr file!", parsed_frames.len());
}

#[test]
fn write_sample_frame_stream() {
    // Write frames to a stream (no header)
    let mut buffer = Vec::new();
    let mut writer = FrameWriter::new(&mut buffer);
    
    let frames = sample_frames();
    for frame in &frames {
        writer.write_frame(frame).unwrap();
    }
    writer.flush().unwrap();
    
    println!("✓ Wrote {} frames to stream ({} bytes)", frames.len(), buffer.len());
    
    // Read back and verify
    let cursor = std::io::Cursor::new(buffer);
    let mut reader = FrameReader::new(cursor);
    
    let mut read_frames = Vec::new();
    while let Some(frame) = reader.read_frame().unwrap() {
        read_frames.push(frame);
    }
    
    assert_eq!(read_frames.len(), frames.len());
    for (i, (written, read)) in frames.iter().zip(read_frames.iter()).enumerate() {
        assert_eq!(written, read, "Frame {} should match", i);
    }
    
    println!("🎉 Successfully wrote and read back {} frames!", frames.len());
}

#[test]
fn write_sample_file_stream() {
    // Write .dcrr file format (header + frames)
    let mut buffer = Vec::new();
    let mut writer = FrameWriter::new(&mut buffer);
    
    // Write header
    let header = FileHeader::with_timestamp(1691234567890);
    writer.write_header(&header).unwrap();
    
    // Write frames
    let frames = sample_frames();
    for frame in &frames {
        writer.write_frame(frame).unwrap();
    }
    writer.flush().unwrap();
    
    println!("✓ Wrote .dcrr file with header + {} frames ({} bytes)", frames.len(), buffer.len());
    
    // Read back and verify
    let cursor = std::io::Cursor::new(buffer);
    let mut reader = FrameReader::new(cursor);
    
    // Read header
    let read_header = reader.read_header().unwrap();
    assert_eq!(read_header.created_at, header.created_at);
    assert_eq!(read_header.version, header.version);
    
    // Read frames
    let mut read_frames = Vec::new();
    while let Some(frame) = reader.read_frame().unwrap() {
        read_frames.push(frame);
    }
    
    assert_eq!(read_frames.len(), frames.len());
    for (i, (written, read)) in frames.iter().zip(read_frames.iter()).enumerate() {
        assert_eq!(written, read, "Frame {} should match", i);
    }
    
    println!("🎉 Successfully wrote and read back .dcrr file with {} frames!", frames.len());
}