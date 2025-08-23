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

  sourceIframe.addEventListener('load', () => {
    console.log('source iframe loaded');
    setTimeout(() => {
      const differences = compareDocumentStyles(sourceIframe.contentDocument.body, player.iframe.contentDocument.body);
      printStyleDifferences(differences);
    }, 3000);
  });
});



/**
 * Gets all computed styles for an element as a plain object
 * @param {Element} element - The element to get styles for
 * @returns {Object} Object containing all computed styles
 */
function getComputedStyles(element) {
  const styles = window.getComputedStyle(element);
  const styleObject = {};
  
  // Get all computed style properties
  for (let i = 0; i < styles.length; i++) {
    const property = styles[i];
    styleObject[property] = styles.getPropertyValue(property);
  }
  
  return styleObject;
}

/**
 * Recursively compares computed styles between two documents with the same structure
 * @param {Document} doc1 - First document to compare
 * @param {Document} doc2 - Second document to compare
 * @param {string} path - Current element path for debugging (optional)
 * @returns {Object} Object containing differences found
 */
function compareDocumentStyles(element1, element2, path = '') {
  const differences = {
    added: [],
    removed: [],
    styleDifferences: [],
    structureMismatch: false
  };
  
  if (!element1 || !element2) {
    differences.structureMismatch = true;
    differences.error = 'One or both documents missing documentElement';
    return differences;
  }
  
  // Start recursive comparison from root elements
  compareElementStyles(element1, element2, differences, path || 'body');
  
  return differences;
}

/**
 * Recursively compares computed styles between two elements and their children
 * @param {Element} element1 - First element to compare
 * @param {Element} element2 - Second element to compare
 * @param {Object} differences - Accumulator for differences found
 * @param {string} path - Current element path for debugging
 */
function compareElementStyles(element1, element2, differences, path) {
  // Compare tag names to ensure same structure
  if (element1.tagName !== element2.tagName) {
    differences.structureMismatch = true;
    differences.error = `Tag mismatch at ${path}: ${element1.tagName} vs ${element2.tagName}`;
    return;
  }
  
  // Compare computed styles
  const styles1 = getComputedStyles(element1);
  const styles2 = getComputedStyles(element2);
  
  const styleDiff = {};
  let hasStyleDifferences = false;
  
  // Compare all style properties
  const allProperties = new Set([...Object.keys(styles1), ...Object.keys(styles2)]);
  
  for (const property of allProperties) {
    const value1 = styles1[property] || '';
    const value2 = styles2[property] || '';
    
    if (value1 !== value2) {
      styleDiff[property] = {
        doc1: value1,
        doc2: value2
      };
      hasStyleDifferences = true;
    }
  }
  
  if (hasStyleDifferences) {
    differences.styleDifferences.push({
      path,
      tagName: element1.tagName,
      differences: styleDiff
    });
  }
  
  // Compare children recursively
  const children1 = Array.from(element1.children);
  const children2 = Array.from(element2.children);
  
  // Check if children count matches
  if (children1.length !== children2.length) {
    differences.structureMismatch = true;
    console.log('children count mismatch', path, element1, element2);
    differences.error = `Children count mismatch at ${path}: ${children1.length} vs ${children2.length}`;
    return;
  }
  
  // Compare each child
  for (let i = 0; i < children1.length; i++) {
    const childPath = `${path} > ${children1[i].tagName.toLowerCase()}:nth-child(${i + 1})`;
    compareElementStyles(children1[i], children2[i], differences, childPath);
    
    // Stop if structure mismatch found
    if (differences.structureMismatch) {
      return;
    }
  }
}

/**
 * Utility function to print differences in a readable format
 * @param {Object} differences - Differences object from compareDocumentStyles
 */
function printStyleDifferences(differences) {
  if (differences.structureMismatch) {
    console.error('Structure mismatch:', differences.error);
    return;
  }
  
  if (differences.styleDifferences.length === 0) {
    console.log('✅ No style differences found');
    return;
  }
  
  console.log(`🔍 Found ${differences.styleDifferences.length} elements with style differences:`);
  
  differences.styleDifferences.forEach((diff, index) => {
    console.log(`\n${index + 1}. ${diff.path} (${diff.tagName})`);
    Object.entries(diff.differences).forEach(([property, values]) => {
      console.log(`   ${property}:`);
      console.log(`     Doc1: "${values.doc1}"`);
      console.log(`     Doc2: "${values.doc2}"`);
    });
  });
}

// Example usage:
// const differences = compareDocumentStyles(document1, document2);
// printStyleDifferences(differences);