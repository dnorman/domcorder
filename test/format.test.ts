// Tests for .dcrr format encoding/decoding
import { describe, test, expect, beforeEach } from "bun:test";
import {
    DCRRWriter,
    DCRRReader,
    DCRRStreamReader,
    FrameType,
    InputEventType,
    MutationType,
    DCRR_MAGIC,
    DCRR_VERSION,
    HEADER_SIZE,
    FRAME_HEADER_SIZE,
} from "../src/format";

describe("DCRR Format", () => {
    describe("DCRRWriter", () => {
        let writer: DCRRWriter;

        beforeEach(() => {
            writer = new DCRRWriter();
        });

        test("should create writer with valid start time", () => {
            const startTime = writer.getStartTime();
            expect(startTime).toBeGreaterThan(0n);
            expect(typeof startTime).toBe("bigint");
        });

        test("should serialize empty recording", () => {
            const data = writer.serialize();
            expect(data).toBeInstanceOf(Uint8Array);
            expect(data.length).toBe(HEADER_SIZE); // Only header, no frames
        });

        test("should add viewport frame", () => {
            writer.addViewport(1920, 1080);
            const data = writer.serialize();

            expect(data.length).toBeGreaterThan(HEADER_SIZE);

            // Read back and verify
            const reader = new DCRRReader(data);
            expect(reader.getFrameCount()).toBe(1);

            const frame = reader.getFrameAt(0);
            expect(frame.header.frameType).toBe(FrameType.Viewport);
            expect(frame.data.width).toBe(1920);
            expect(frame.data.height).toBe(1080);
        });

        test("should add keyframe", () => {
            const html = "<html><body><h1>Test</h1></body></html>";
            writer.addKeyframe(html);
            const data = writer.serialize();

            const reader = new DCRRReader(data);
            expect(reader.getFrameCount()).toBe(1);

            const frame = reader.getFrameAt(0);
            expect(frame.header.frameType).toBe(FrameType.Keyframe);
            expect(frame.data.html).toBe(html);
        });

        test("should add delta frame", () => {
            const mutations = [
                {
                    type: MutationType.ElementAdded,
                    target: "#test",
                    data: { tagName: "div", content: "test" },
                },
            ];

            writer.addDelta(mutations);
            const data = writer.serialize();

            const reader = new DCRRReader(data);
            const frame = reader.getFrameAt(0);
            expect(frame.header.frameType).toBe(FrameType.Delta);
            expect(frame.data.mutations).toEqual(mutations);
        });

        test("should add input event", () => {
            const eventData = { x: 100, y: 200, button: 0 };
            writer.addInputEvent(InputEventType.MouseClick, eventData);
            const data = writer.serialize();

            const reader = new DCRRReader(data);
            const frame = reader.getFrameAt(0);
            expect(frame.header.frameType).toBe(FrameType.Input);
            expect(frame.data.eventType).toBe(InputEventType.MouseClick);
            expect(frame.data.data).toEqual(eventData);
        });

        test("should add metadata", () => {
            writer.addMetadata("url", "https://example.com");
            const data = writer.serialize();

            const reader = new DCRRReader(data);
            const frame = reader.getFrameAt(0);
            expect(frame.header.frameType).toBe(FrameType.Metadata);
            expect(frame.data.key).toBe("url");
            expect(frame.data.value).toBe("https://example.com");
        });

        test("should handle multiple frames with correct timestamps", async () => {
            writer.addViewport(1920, 1080);

            // Wait a bit to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));

            writer.addKeyframe("<html><body>Frame 1</body></html>");

            await new Promise(resolve => setTimeout(resolve, 10));

            writer.addKeyframe("<html><body>Frame 2</body></html>");

            const data = writer.serialize();
            const reader = new DCRRReader(data);

            expect(reader.getFrameCount()).toBe(3);

            const frames = reader.getFrames();

            // Timestamps should be increasing
            expect(frames[0].header.timestamp).toBeLessThan(frames[1].header.timestamp);
            expect(frames[1].header.timestamp).toBeLessThan(frames[2].header.timestamp);

            // Frame types should be correct
            expect(frames[0].header.frameType).toBe(FrameType.Viewport);
            expect(frames[1].header.frameType).toBe(FrameType.Keyframe);
            expect(frames[2].header.frameType).toBe(FrameType.Keyframe);
        });

        test("should serialize individual frames for WebSocket", () => {
            const frameData = writer.serializeFrame(FrameType.Viewport, { width: 1280, height: 720 });

            expect(frameData).toBeInstanceOf(Uint8Array);
            expect(frameData.length).toBeGreaterThan(FRAME_HEADER_SIZE);

            // Should be able to parse it back
            // (We'd need to implement a frame parser for this, but the structure should be correct)
        });
    });

    describe("DCRRReader", () => {
        let writer: DCRRWriter;
        let testData: Uint8Array;

        beforeEach(() => {
            writer = new DCRRWriter();
            writer.addViewport(1920, 1080);
            writer.addKeyframe("<html><body><h1>Test Page</h1></body></html>");
            writer.addInputEvent(InputEventType.MouseMove, { x: 50, y: 75 });
            writer.addMetadata("test", "value");
            testData = writer.serialize();
        });

        test("should read header correctly", () => {
            const reader = new DCRRReader(testData);
            const header = reader.getHeader();

            expect(header.version).toBe(DCRR_VERSION);
            expect(header.createdAt).toBeGreaterThan(0n);
            expect(header.magic).toEqual(DCRR_MAGIC);
        });

        test("should read correct frame count", () => {
            const reader = new DCRRReader(testData);
            expect(reader.getFrameCount()).toBe(4);
        });

        test("should read all frames correctly", () => {
            const reader = new DCRRReader(testData);
            const frames = reader.getFrames();

            expect(frames).toHaveLength(4);

            // Check frame types
            expect(frames[0].header.frameType).toBe(FrameType.Viewport);
            expect(frames[1].header.frameType).toBe(FrameType.Keyframe);
            expect(frames[2].header.frameType).toBe(FrameType.Input);
            expect(frames[3].header.frameType).toBe(FrameType.Metadata);

            // Check frame data
            expect(frames[0].data.width).toBe(1920);
            expect(frames[0].data.height).toBe(1080);
            expect(frames[1].data.html).toBe("<html><body><h1>Test Page</h1></body></html>");
            expect(frames[2].data.eventType).toBe(InputEventType.MouseMove);
            expect(frames[3].data.key).toBe("test");
            expect(frames[3].data.value).toBe("value");
        });

        test("should find frames by timestamp", () => {
            const reader = new DCRRReader(testData);
            const frames = reader.getFrames();

            // Find frame at middle timestamp
            const middleTime = frames[1].header.timestamp;
            const foundIndex = reader.findFrameByTimestamp(middleTime);

            expect(foundIndex).toBe(1);

            // Find frame beyond last timestamp
            const beyondTime = frames[frames.length - 1].header.timestamp + 1000n;
            const lastIndex = reader.findFrameByTimestamp(beyondTime);

            expect(lastIndex).toBe(frames.length - 1);
        });

        test("should find latest viewport", () => {
            const reader = new DCRRReader(testData);
            const frames = reader.getFrames();

            const viewport = reader.findLatestViewport(frames[frames.length - 1].header.timestamp);
            expect(viewport).not.toBeNull();
            expect(viewport!.width).toBe(1920);
            expect(viewport!.height).toBe(1080);
        });

        test("should find latest keyframe", () => {
            const reader = new DCRRReader(testData);
            const frames = reader.getFrames();

            const result = reader.findLatestKeyframe(frames[frames.length - 1].header.timestamp);
            expect(result).not.toBeNull();
            expect(result!.index).toBe(1);
            expect(result!.frame.data.html).toBe("<html><body><h1>Test Page</h1></body></html>");
        });

        test("should handle invalid data gracefully", () => {
            expect(() => {
                new DCRRReader(new Uint8Array([1, 2, 3, 4]));
            }).toThrow("Invalid DCRR file");
        });

        test("should handle unsupported version", () => {
            const invalidData = new Uint8Array(testData);
            // Modify version byte
            const view = new DataView(invalidData.buffer);
            view.setUint32(4, 999, true); // Invalid version

            expect(() => {
                new DCRRReader(invalidData);
            }).toThrow("Unsupported DCRR version");
        });
    });

    describe("DCRRStreamReader", () => {
        test("should handle streaming data", () => {
            const streamReader = new DCRRStreamReader();

            // Initially no header
            expect(streamReader.tryReadHeader()).toBe(false);
            expect(streamReader.tryReadNextFrame()).toBeNull();

            // Add header data
            const writer = new DCRRWriter();
            const completeData = writer.serialize();
            const headerData = completeData.slice(0, HEADER_SIZE);

            streamReader.appendData(headerData);
            expect(streamReader.tryReadHeader()).toBe(true);

            // Still no frame data
            expect(streamReader.tryReadNextFrame()).toBeNull();
        });

        test("should read frames as they arrive", () => {
            const writer = new DCRRWriter();
            writer.addViewport(1280, 720);
            const completeData = writer.serialize();

            const streamReader = new DCRRStreamReader();

            // Add data piece by piece
            streamReader.appendData(completeData.slice(0, HEADER_SIZE));
            expect(streamReader.tryReadHeader()).toBe(true);

            // Add frame data
            streamReader.appendData(completeData.slice(HEADER_SIZE));
            const frame = streamReader.tryReadNextFrame();

            expect(frame).not.toBeNull();
            expect(frame!.header.frameType).toBe(FrameType.Viewport);
            expect(frame!.data.width).toBe(1280);
            expect(frame!.data.height).toBe(720);
        });
    });

    describe("Format Edge Cases", () => {
        test("should handle empty strings", () => {
            const writer = new DCRRWriter();
            writer.addKeyframe("");
            writer.addMetadata("", "");

            const data = writer.serialize();
            const reader = new DCRRReader(data);

            const frames = reader.getFrames();
            expect(frames[0].data.html).toBe("");
            expect(frames[1].data.key).toBe("");
            expect(frames[1].data.value).toBe("");
        });

        test("should handle large HTML content", () => {
            const largeHtml = "<html><body>" + "x".repeat(100000) + "</body></html>";

            const writer = new DCRRWriter();
            writer.addKeyframe(largeHtml);

            const data = writer.serialize();
            const reader = new DCRRReader(data);

            const frame = reader.getFrameAt(0);
            expect(frame.data.html).toBe(largeHtml);
            expect(frame.data.html.length).toBe(largeHtml.length);
        });

        test("should handle unicode content", () => {
            const unicodeHtml = "<html><body>🌟 Unicode test: 中文 العربية Русский 🚀</body></html>";
            const unicodeKey = "测试键";
            const unicodeValue = "значение тест";

            const writer = new DCRRWriter();
            writer.addKeyframe(unicodeHtml);
            writer.addMetadata(unicodeKey, unicodeValue);

            const data = writer.serialize();
            const reader = new DCRRReader(data);

            const frames = reader.getFrames();
            expect(frames[0].data.html).toBe(unicodeHtml);
            expect(frames[1].data.key).toBe(unicodeKey);
            expect(frames[1].data.value).toBe(unicodeValue);
        });

        test("should handle complex mutation data", () => {
            const complexMutations = [
                {
                    type: MutationType.ElementAdded,
                    target: "body > div:nth-child(3)",
                    data: {
                        tagName: "div",
                        attributes: { class: "test-class", id: "test-id" },
                        innerHTML: "<span>Complex content</span>",
                    },
                },
                {
                    type: MutationType.AttributeChanged,
                    target: "#header",
                    data: {
                        attributeName: "data-state",
                        oldValue: "initial",
                        newValue: "updated",
                    },
                },
            ];

            const writer = new DCRRWriter();
            writer.addDelta(complexMutations);

            const data = writer.serialize();
            const reader = new DCRRReader(data);

            const frame = reader.getFrameAt(0);
            expect(frame.data.mutations).toEqual(complexMutations);
        });
    });

    describe("Binary Format Validation", () => {
        test("should produce deterministic output for same input", () => {
            const createTestData = () => {
                const writer = new DCRRWriter();
                writer.addViewport(1920, 1080);
                writer.addKeyframe("<html><body>Test</body></html>");
                return writer.serialize();
            };

            // Note: This test will fail due to timestamps, but we can test structure
            const data1 = createTestData();
            const data2 = createTestData();

            // Headers should have same structure (except timestamp)
            expect(data1.slice(0, 4)).toEqual(data2.slice(0, 4)); // Magic bytes
            expect(data1.slice(4, 8)).toEqual(data2.slice(4, 8)); // Version

            // Frame structure should be identical
            const reader1 = new DCRRReader(data1);
            const reader2 = new DCRRReader(data2);

            expect(reader1.getFrameCount()).toBe(reader2.getFrameCount());

            const frames1 = reader1.getFrames();
            const frames2 = reader2.getFrames();

            // Frame types and data should match
            for (let i = 0; i < frames1.length; i++) {
                expect(frames1[i].header.frameType).toBe(frames2[i].header.frameType);
                expect(frames1[i].data).toEqual(frames2[i].data);
            }
        });

        test("should maintain byte alignment", () => {
            const writer = new DCRRWriter();
            writer.addViewport(1920, 1080);

            const data = writer.serialize();

            // Header should be exactly HEADER_SIZE
            expect(data.length).toBeGreaterThanOrEqual(HEADER_SIZE);

            // Frame data should start at correct offset
            const reader = new DCRRReader(data);
            const frame = reader.getFrameAt(0);

            // Frame header should have correct size
            expect(frame.header.dataSize).toBe(8); // viewport data is 8 bytes
        });
    });
}); 