import { 
  PageRecorder,
  PagePlayer
} from "../../dist/index.js";

// General Page Set Up
const stylesheet = new CSSStyleSheet();
stylesheet.replaceSync(`
  .adopted-style-sheet {
    background-color: green;
    color: white;
  }
`);
document.adoptedStyleSheets = [stylesheet];


// Player / Recorder Set Up

const iFrame = document.getElementById('target');
const pagePlayer = new PagePlayer(iFrame.contentWindow.document);

const screenRecorder = new PageRecorder(document, (frame) => {
  console.log("frame", frame);
  pagePlayer.handleFrame(frame);
});
screenRecorder.start();
