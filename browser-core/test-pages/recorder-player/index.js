import { PagePlayerComponent, FrameChunkReader } from "../../../dist/index.js";

const targetContainer = document.getElementById("target");

const player = new PagePlayerComponent(targetContainer);

const frameChunkReader = new FrameChunkReader({
  next: (frame) => {
    player.handleFrame(frame);
  }
});

const handleChunk = (chunk) => {
  console.log("forwarding chunk to player", chunk.length);
  frameChunkReader.read(chunk);
};

window.handleChunk = handleChunk;

player.ready().then(() => {
  const sourceIframe = document.getElementById("source");
  sourceIframe.src = "source-page/index.html";
});
