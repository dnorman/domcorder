/**
 * Interface for style differences between two elements
 */
export interface StyleDifference {
  doc1: string;
  doc2: string;
}

/**
 * Interface for element differences found during comparison
 */
export interface ElementDifference {
  path: string;
  tagName: string;
  differences: Record<string, StyleDifference>;
  element1: Element;
  element2: Element;
}

/**
 * Interface for the complete comparison result
 */
export interface DocumentComparisonResult {
  added: any[];
  removed: any[];
  styleDifferences: ElementDifference[];
  structureMismatch: boolean;
  error?: string;
}

/**
 * Gets all computed styles for an element as a plain object
 * @param element - The element to get styles for
 * @returns Object containing all computed styles
 */
export function getComputedStyles(element: Element): Record<string, string> {
  const styles = window.getComputedStyle(element);
  const styleObject: Record<string, string> = {};
  
  // Get all computed style properties
  for (let i = 0; i < styles.length; i++) {
    const property = styles[i];
    styleObject[property] = styles.getPropertyValue(property);
  }
  
  return styleObject;
}

/**
 * Recursively compares computed styles between two elements and their children
 * @param element1 - First element to compare
 * @param element2 - Second element to compare
 * @param differences - Accumulator for differences found
 * @param path - Current element path for debugging
 */
function compareElementStyles(
  element1: Element, 
  element2: Element, 
  differences: DocumentComparisonResult, 
  path: string
): void {
  // Compare tag names to ensure same structure
  if (element1.tagName !== element2.tagName) {
    differences.structureMismatch = true;
    differences.error = `Tag mismatch at ${path}: ${element1.tagName} vs ${element2.tagName}`;
    return;
  }
  
  // Compare computed styles
  const styles1 = getComputedStyles(element1);
  const styles2 = getComputedStyles(element2);
  
  const styleDiff: Record<string, StyleDifference> = {};
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
      differences: styleDiff,
      element1: element1,
      element2: element2
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
 * Recursively compares computed styles between two documents with the same structure
 * @param element1 - First element to compare
 * @param element2 - Second element to compare
 * @param path - Current element path for debugging (optional)
 * @returns Object containing differences found
 */
export function compareDocumentStyles(
  element1: Element, 
  element2: Element, 
  path: string = ''
): DocumentComparisonResult {
  const differences: DocumentComparisonResult = {
    added: [],
    removed: [],
    styleDifferences: [],
    structureMismatch: false
  };
  
  if (!element1 || !element2) {
    differences.structureMismatch = true;
    differences.error = 'One or both elements are null/undefined';
    return differences;
  }
  
  // Start recursive comparison from root elements
  compareElementStyles(element1, element2, differences, path || 'body');
  
  return differences;
}

/**
 * Utility function to print differences in a readable format
 * @param differences - Differences object from compareDocumentStyles
 */
export function printStyleDifferences(differences: DocumentComparisonResult): void {
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
    
    // Log the DOM elements that have differences
    if (diff.element1 && diff.element2) {
      console.log('   DOM Elements:');
      console.log('     Element 1:', diff.element1);
      console.log('     Element 2:', diff.element2);
    }
    
    Object.entries(diff.differences).forEach(([property, values]) => {
      console.log(`   ${property}:`);
      console.log(`     Doc1: "${values.doc1}"`);
      console.log(`     Doc2: "${values.doc2}"`);
    });
  });
}
