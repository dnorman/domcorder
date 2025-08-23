import { PagePlayerComponent, compareDocumentStyles, printStyleDifferences } from "../../../dist/index.js";

const targetContainer = document.getElementById('target');

const player = new PagePlayerComponent(targetContainer);

const frameHandler = (frame) => {
  player.handleFrame(frame);
}

window.frameHandler = frameHandler;

player.ready().then(() => {
  console.log('player ready');
  const sourceIframe = document.getElementById('source');
  sourceIframe.src = "source-page/index.html";

  sourceIframe.addEventListener('load', () => {
    console.log('source iframe loaded');
    setTimeout(() => {
      const differences = compareDocumentStyles(sourceIframe.contentDocument.body, player.iframe.contentDocument.body);
      printStyleDifferences(differences);
    }, 1000);
  });
});