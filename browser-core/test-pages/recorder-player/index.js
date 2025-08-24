import {
  PagePlayerComponent,
  compareDocumentStyles,
  printStyleDifferences,
  compareIframeDimensions,
  compareDomContent,
  compareHeightAffectingStyles,
  inspectElementRendering,
  inspectBgImageContainer,
  checkForMissingContent,
  checkBgImageContainerText,
  compareCssInheritance,
  checkAdoptedStyleSheets,
  compareDefaultStyles,
  compareProblematicElements,
  investigateRenderingContext,
  checkFontLoading,
  checkTimingIssues,
  investigateDocumentStructure,
  attemptCompatibilityModeFix,
} from "../../../dist/index.js";

const targetContainer = document.getElementById("target");

const player = new PagePlayerComponent(targetContainer);

const chunkHandler = (chunk) => {
  console.log("Received chunk length:", chunk.length);
  player.handleChunk(chunk);
};

window.chunkHandler = chunkHandler;

player.ready().then(() => {
  console.log("player ready");
  const sourceIframe = document.getElementById("source");
  sourceIframe.src = "source-page/index.html";

  sourceIframe.addEventListener("load", () => {
    console.log("source iframe loaded");
    // setTimeout(() => {
    //   // Compare iframe dimensions first
    //   compareIframeDimensions(sourceIframe, player.iframe);

    //   // Compare DOM content structure
    //   compareDomContent(sourceIframe.contentDocument.body, player.iframe.contentDocument.body, 'body');

    //   // Compare height-affecting styles specifically
    //   compareHeightAffectingStyles(sourceIframe.contentDocument.body, player.iframe.contentDocument.body, 'body');

    //   // Inspect actual rendered dimensions
    //   inspectElementRendering(sourceIframe.contentDocument.body, player.iframe.contentDocument.body, 'body');

    //   // Specifically inspect the bg-image-container
    //   inspectBgImageContainer(sourceIframe.contentDocument.body, player.iframe.contentDocument.body);

    //   // Check for missing content or text nodes
    //   checkForMissingContent(sourceIframe.contentDocument.body, player.iframe.contentDocument.body, 'body');

    //   // Specifically check bg-image-container text content
    //   checkBgImageContainerText(sourceIframe.contentDocument.body, player.iframe.contentDocument.body);

    //   // Compare CSS inheritance and default styles
    //   compareCssInheritance(sourceIframe, player.iframe);

    //   // Check adopted stylesheets specifically
    //   checkAdoptedStyleSheets(sourceIframe, player.iframe);

    //   // Compare default browser styles
    //   compareDefaultStyles(sourceIframe, player.iframe);

    //   // Analyze problematic elements in detail
    //   compareProblematicElements(sourceIframe, player.iframe);

    //   // Investigate document structure (DOCTYPE, etc.)
    //   investigateDocumentStructure(sourceIframe, player.iframe);

    //   // Investigate rendering context differences
    //   investigateRenderingContext(sourceIframe, player.iframe);

    //   // Check font loading issues
    //   checkFontLoading(sourceIframe, player.iframe);

    //   // Check timing issues
    //   checkTimingIssues(sourceIframe, player.iframe);

    //   // Attempt to fix compatibility mode
    //   attemptCompatibilityModeFix(sourceIframe, player.iframe);

    //   // Then compare document styles
    //   const differences = compareDocumentStyles(sourceIframe.contentDocument.body, player.iframe.contentDocument.body);
    //   printStyleDifferences(differences);
    // }, 100);
  });
});
