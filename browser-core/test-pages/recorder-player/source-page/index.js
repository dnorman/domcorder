import { PageRecorder, PageRecordingClient, FrameChunkWriter } from "../../../dist/index.js";

// General Page Set Up
const stylesheet = new CSSStyleSheet();
stylesheet.replaceSync(`
  .adopted-style-sheet {
    background-color: green;
    color: white;
  }
`);
document.adoptedStyleSheets = [stylesheet];

const pageRecorder = new PageRecorder(document);

const frameChunkWriter = new FrameChunkWriter({
  next: (chunk) => {
    window.parent.handleChunk(chunk);
  }
});

pageRecorder.addFrameHandler((frame) => {
  return frameChunkWriter.write(frame);
});

const pageRecordingClient = new PageRecordingClient(pageRecorder, "ws://localhost:8723/ws/record");
pageRecordingClient.start();

pageRecorder.start();
