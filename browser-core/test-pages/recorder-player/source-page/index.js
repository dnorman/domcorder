import { PageRecorder } from "../../../dist/index.js";

// General Page Set Up
const stylesheet = new CSSStyleSheet();
stylesheet.replaceSync(`
  .adopted-style-sheet {
    background-color: green;
    color: white;
  }
`);
document.adoptedStyleSheets = [stylesheet];

const screenRecorder = new PageRecorder(document, (frame) => {
  // This frameHandler is still needed for the recorder's internal logic
  // We'll tee the writer stream to send chunks to the parent
});

// Get the parent stream (already teed in PageRecorder)
const parentStream = screenRecorder.getParentStream();

// Send chunks to parent
const parentReader = parentStream.getReader();
(async () => {
  try {
    while (true) {
      const { done, value } = await parentReader.read();
      if (done) break;

      console.log("Sending chunk to parent:", value.length);
      window.parent.chunkHandler(value);
    }
  } catch (error) {
    console.error("Error sending chunks to parent:", error);
  }
})();

screenRecorder.start();
