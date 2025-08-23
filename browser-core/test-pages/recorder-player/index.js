import { PagePlayerComponent } from "../../../dist/index.js";

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
});