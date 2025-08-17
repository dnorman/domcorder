import { 
  InlineSnapshotStreamer,
  DomChangeDetector,
  DomMutator,
  DomMaterializer,
  NodeIdBiMap } from "../../dist/index.js";

const sourceDocNodeIdMap = new NodeIdBiMap();
sourceDocNodeIdMap.assignNodeIdsToSubTree(document);

screenshot();

async function screenshot() {
  let assets = [];
  let vdoc;

  const transformer = new InlineSnapshotStreamer(document, sourceDocNodeIdMap);

  transformer.events.on("snapshotStarted", (ev) => {
    console.log("event", ev);
    vdoc = ev.snapshot;
  });

  transformer.events.on("asset", (ev) => {
    console.log("event", ev);
    assets.push(ev.asset);
  });
  
  transformer.events.on("snapshotComplete", (ev) => {
    console.log("event", ev);
    injectSnapshotAndSync(vdoc, assets);

  });
  await transformer.start();
}

function injectSnapshotAndSync(vdoc, assets) {
  const iFrame = document.getElementById('target');
  
  const materializer = new DomMaterializer(iFrame.contentWindow.document);
  materializer.materialize(vdoc, assets);
  
  const targetDocNodeIdMap = new NodeIdBiMap();
  targetDocNodeIdMap.adoptNodesFromSubTree(iFrame.contentWindow.document);

  const mutator = new DomMutator(iFrame.contentWindow.document.documentElement, targetDocNodeIdMap);

  new DomChangeDetector(document, sourceDocNodeIdMap, (operations) => {
    operations.forEach(op => {
      console.log(op);
    });

    mutator.applyOps(operations);
  });
}