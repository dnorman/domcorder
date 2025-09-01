import { PagePlayerComponent, FrameChunkReader } from "../../../dist/index.js";

const targetContainer = document.getElementById("target");

const player = new PagePlayerComponent(targetContainer);

const frameChunkReader = new FrameChunkReader({
  next: (frame) => {
    // console.log('frame', frame);
    player.handleFrame(frame);
  },
});

const handleChunk = (chunk) => {
  frameChunkReader.read(chunk);
};

window.handleChunk = handleChunk;

player.ready().then(() => {
  const sourceIframe = document.getElementById("source");
  sourceIframe.src = "source-page/index.html";

  // Wait for source iframe to load and then start buffer meter updates
  sourceIframe.onload = () => {
    // Start buffer meter updates
    setInterval(() => {
      try {
        const sourceWindow = sourceIframe.contentWindow;
        if (sourceWindow && sourceWindow.getBufferInfo) {
          const bufferInfo = sourceWindow.getBufferInfo();
          if (bufferInfo) {
            const bufferSize = bufferInfo.bufferedAmount;
            const bufferStatus =
              bufferSize > 1024 * 1024
                ? "⚠️ Large"
                : bufferSize > 100 * 1024
                ? "🟡 Medium"
                : bufferSize > 0
                ? "🟢 Small"
                : "✅ None";

            document.getElementById("buffer-size").textContent =
              bufferSize > 1024 * 1024
                ? `${(bufferSize / 1024 / 1024).toFixed(1)}M`
                : bufferSize > 1024
                ? `${(bufferSize / 1024).toFixed(1)}K`
                : bufferSize.toString();
            document.getElementById("buffer-status").textContent = bufferStatus;
          }
        }
      } catch (e) {
        // Cross-origin or not ready yet
        document.getElementById("buffer-size").textContent = "?";
        document.getElementById("buffer-status").textContent = "Loading...";
      }
    }, 100);
  };
});
