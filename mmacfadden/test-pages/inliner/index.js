import { InlineSnapshotStreamer, DomMaterializer, NodeIdBiMap } from "../../dist/index.js";

const nodeIdMap = new NodeIdBiMap();
nodeIdMap.assignNodeIdsToSubTree(document);

const transformer = new InlineSnapshotStreamer(document, nodeIdMap);

async function screenshot() {
  let assets = [];
  let vdoc;

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
    const ifrm = document.getElementById('screenshot');
  
    const materializer = new DomMaterializer(ifrm.contentWindow.document);
    materializer.materialize(vdoc, assets);
    
    const adoptedMap = new NodeIdBiMap();
    // adoptedMap.adoptNodesFromSubTree(ifrm.contentWindow.document);
    // console.log("adoptedMap", adoptedMap);

  });
  await transformer.start();
}

screenshot();