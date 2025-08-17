import { 
  KeyFrameGenerator,
  DomChangeDetector,
  DomMutator,
  DomMaterializer,
  NodeIdBiMap } from "../../dist/index.js";

const sourceDocNodeIdMap = new NodeIdBiMap();
sourceDocNodeIdMap.assignNodeIdsToSubTree(document);

start();

async function start() {
  let assets = [];
  let vdoc;

  const transformer = new KeyFrameGenerator(document, sourceDocNodeIdMap);

  await transformer.generateKeyFrame({
    onSnapshotStarted: (ev) => {
      console.log("snapshotStarted", ev);
      vdoc = ev.snapshot;
      
    },
    onAsset: (asset) => {
      console.log("asset", asset);
      assets.push(asset);
    },
    onSnapshotComplete: () => {
      console.log("snapshotComplete");
      injectSnapshotAndSync(vdoc, assets);
    }
  });
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