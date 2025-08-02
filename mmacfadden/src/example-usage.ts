import { DomChangeDetector } from "./DomChangeDetector";

/**
 * Example usage of DomChangeDetector's depth-first traversal and ID assignment
 */

// Example 1: Basic usage
function basicExample() {
  console.log("=== Basic DomChangeDetector Example ===");
  
  // Create a test DOM structure
  const container = document.createElement("div");
  container.id = "example-container";
  container.innerHTML = `
    <div class="parent">
      <h1>Title</h1>
      <p>Paragraph 1</p>
      <div class="nested">
        <span>Nested content</span>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      </div>
      <p>Paragraph 2</p>
    </div>
  `;
  document.body.appendChild(container);

  // Create the detector (automatically assigns IDs)
  const detector = new DomChangeDetector(container);
  
  console.log(`Total nodes with IDs: ${detector.getNodeCount()}`);
  
  // Get the mappings
  const nodeToIdMap = detector.getNodeToIdMap();
  const idToNodeMap = detector.getIdToNodeMap();
  
  console.log("Node to ID mapping:");
  nodeToIdMap.forEach((id, node) => {
    const element = node as Element;
    console.log(`  ${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${element.className}` : ''} -> ID ${id}`);
  });
  
  console.log("\nID to Node mapping:");
  idToNodeMap.forEach((node, id) => {
    const element = node as Element;
    console.log(`  ID ${id} -> ${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${element.className}` : ''}`);
  });
  
  // Clean up
  container.remove();
}

// Example 2: Working with specific nodes
function nodeLookupExample() {
  console.log("=== Node Lookup Example ===");
  
  const container = document.createElement("div");
  container.innerHTML = `
    <div id="root">
      <span id="child1">Child 1</span>
      <p id="child2">Child 2</p>
      <div id="child3">
        <strong>Bold text</strong>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const detector = new DomChangeDetector(container);
  
  // Find specific nodes
  const span = container.querySelector("#child1")!;
  const p = container.querySelector("#child2")!;
  const strong = container.querySelector("strong")!;
  
  // Get their IDs
  const spanId = detector.getNodeId(span);
  const pId = detector.getNodeId(p);
  const strongId = detector.getNodeId(strong);
  
  console.log(`Span ID: ${spanId}`);
  console.log(`Paragraph ID: ${pId}`);
  console.log(`Strong ID: ${strongId}`);
  
  // Retrieve nodes by ID
  const retrievedSpan = detector.getNodeById(spanId!);
  const retrievedP = detector.getNodeById(pId!);
  const retrievedStrong = detector.getNodeById(strongId!);
  
  console.log(`Retrieved span: ${retrievedSpan === span}`);
  console.log(`Retrieved paragraph: ${retrievedP === p}`);
  console.log(`Retrieved strong: ${retrievedStrong === strong}`);
  
  // Check that IDs are stored as properties
  console.log(`Span __domId property: ${(span as any).__domId}`);
  console.log(`Paragraph __domId property: ${(p as any).__domId}`);
  
  container.remove();
}

// Example 3: Depth-first traversal verification
function traversalOrderExample() {
  console.log("=== Depth-First Traversal Order Example ===");
  
  const container = document.createElement("div");
  container.innerHTML = `
    <div id="A">
      <div id="B">
        <span id="D">D</span>
        <span id="E">E</span>
      </div>
      <div id="C">
        <span id="F">F</span>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const detector = new DomChangeDetector(container);
  const nodeToIdMap = detector.getNodeToIdMap();
  
  // Expected depth-first order: A, B, D, E, C, F
  const expectedOrder = ["A", "B", "D", "E", "C", "F"];
  
  console.log("Depth-first traversal order:");
  expectedOrder.forEach((id, index) => {
    const node = container.querySelector(`#${id}`)!;
    const assignedId = nodeToIdMap.get(node);
    console.log(`  ${index + 1}. ${id} -> ID ${assignedId}`);
  });
  
  container.remove();
}

// Example 4: Handling dynamic changes
function dynamicChangesExample() {
  console.log("=== Dynamic Changes Example ===");
  
  const container = document.createElement("div");
  container.innerHTML = `<div id="root">Original content</div>`;
  document.body.appendChild(container);

  const detector = new DomChangeDetector(container);
  
  console.log(`Initial node count: ${detector.getNodeCount()}`);
  
  // Add new elements
  const root = container.querySelector("#root")!;
  const newSpan = document.createElement("span");
  newSpan.textContent = "New content";
  root.appendChild(newSpan);
  
  const newDiv = document.createElement("div");
  newDiv.innerHTML = "<p>Nested content</p>";
  root.appendChild(newDiv);
  
  // Reassign IDs to include new nodes
  detector.reassignNodeIds();
  
  console.log(`Updated node count: ${detector.getNodeCount()}`);
  
  // Check that new nodes have IDs
  console.log(`New span ID: ${detector.getNodeId(newSpan)}`);
  console.log(`New div ID: ${detector.getNodeId(newDiv)}`);
  console.log(`New p ID: ${detector.getNodeId(newDiv.querySelector("p")!)}`);
  
  container.remove();
}

// Example 5: Performance demonstration
function performanceExample() {
  console.log("=== Performance Example ===");
  
  // Create a large DOM structure
  const container = document.createElement("div");
  let html = "";
  
  // Create 1000 nested elements
  for (let i = 0; i < 1000; i++) {
    html += `<div id="node-${i}">Node ${i}`;
    if (i % 10 === 0) {
      html += `<span>Special ${i}</span>`;
    }
    html += "</div>";
  }
  
  container.innerHTML = html;
  document.body.appendChild(container);

  // Measure performance
  const startTime = performance.now();
  const detector = new DomChangeDetector(container);
  const endTime = performance.now();
  
  console.log(`Time to assign IDs to ${detector.getNodeCount()} nodes: ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`Average time per node: ${((endTime - startTime) / detector.getNodeCount()).toFixed(4)}ms`);
  
  // Test lookup performance
  const lookupStart = performance.now();
  for (let i = 0; i < 1000; i++) {
    const node = container.querySelector(`#node-${i}`)!;
    detector.getNodeId(node);
  }
  const lookupEnd = performance.now();
  
  console.log(`Time for 1000 node lookups: ${(lookupEnd - lookupStart).toFixed(2)}ms`);
  
  container.remove();
}

// Run examples when DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(basicExample, 100);
      setTimeout(nodeLookupExample, 2000);
      setTimeout(traversalOrderExample, 4000);
      setTimeout(dynamicChangesExample, 6000);
      setTimeout(performanceExample, 8000);
    });
  } else {
    setTimeout(basicExample, 100);
    setTimeout(nodeLookupExample, 2000);
    setTimeout(traversalOrderExample, 4000);
    setTimeout(dynamicChangesExample, 6000);
    setTimeout(performanceExample, 8000);
  }
}

export {
  basicExample,
  nodeLookupExample,
  traversalOrderExample,
  dynamicChangesExample,
  performanceExample
}; 