// Simple test for .dcrr format
import { DCRRWriter, DCRRReader, FrameType, InputEventType } from '../format.js';

function testBasicFormat() {
    console.log('Testing basic .dcrr format...');

    // Create writer and add some frames
    const writer = new DCRRWriter();

    // Add viewport frame
    writer.addViewport(1920, 1080);

    // Add keyframe
    writer.addKeyframe('<html><body><h1>Test Page</h1></body></html>');

    // Add input event
    writer.addInputEvent(InputEventType.MouseClick, { x: 100, y: 200, button: 0 });

    // Add metadata
    writer.addMetadata('url', 'https://example.com');

    // Serialize
    const data = writer.serialize();
    console.log(`Serialized ${data.length} bytes`);

    // Read back
    const reader = new DCRRReader(data);
    const header = reader.getHeader();

    console.log('Header:', {
        version: header.version,
        createdAt: new Date(Number(header.createdAt)),
        frameCount: reader.getFrameCount()
    });

    // Check frames
    const frames = reader.getFrames();
    frames.forEach((frame, i) => {
        console.log(`Frame ${i}:`, {
            timestamp: Number(frame.header.timestamp),
            type: FrameType[frame.header.frameType],
            dataSize: frame.header.dataSize,
            data: frame.data
        });
    });

    console.log('✅ Basic format test passed');
}

function testSeekingFunctions() {
    console.log('Testing seeking functions...');

    const writer = new DCRRWriter();

    // Simulate a recording sequence
    writer.addViewport(1920, 1080);

    // Wait a bit then add keyframe
    setTimeout(() => {
        writer.addKeyframe('<html><body><h1>Frame 1</h1></body></html>');

        setTimeout(() => {
            writer.addViewport(1280, 720); // Resize

            setTimeout(() => {
                writer.addKeyframe('<html><body><h1>Frame 2</h1></body></html>');

                const data = writer.serialize();
                const reader = new DCRRReader(data);

                // Test seeking
                const lastFrame = reader.getFrameCount() - 1;
                const targetTime = reader.getFrameAt(lastFrame).header.timestamp;

                const viewport = reader.findLatestViewport(targetTime);
                const keyframe = reader.findLatestKeyframe(targetTime);

                console.log('Latest viewport:', viewport);
                console.log('Latest keyframe:', keyframe?.frame.data);

                console.log('✅ Seeking test passed');
            }, 10);
        }, 10);
    }, 10);
}

// Run tests
testBasicFormat();
testSeekingFunctions(); 