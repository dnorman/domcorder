import { InlineSnapshotStreamer, DomMaterializer, NodeIdBiMap } from "../../dist/index.js";

const nodeIdMap = new NodeIdBiMap(document);
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
    // console.log("doc", inlined);
    
    // const subDoc = ifrm.contentWindow.document;
    // subDoc.documentElement.outerHTML = inlined.documentElement.outerHTML;
  });
  await transformer.start();

  // var ifrm = document.getElementById('screenshot');
  // const subDoc = ifrm.contentWindow.document;
  // subDoc.documentElement.innerHTML = inlined.documentElement.innerHTML;
  // const links = [];
  // for (const child of subDoc.head.children) {
  //   if (child.tagName === "LINK") {
  //     links.push(child);
  //   }
  // }

  // links.forEach(l => subDoc.head.removeChild(l));
}

screenshot();