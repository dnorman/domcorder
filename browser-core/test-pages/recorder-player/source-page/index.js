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
  window.parent.frameHandler(frame);
});
screenRecorder.start();