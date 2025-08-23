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
 * Interface for iframe/document dimensions
 */
export interface DocumentDimensions {
  iframeWidth: number;
  iframeHeight: number;
  documentWidth: number;
  documentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * Gets dimensions and viewport information for a document
 * @param iframe - The iframe containing the document
 * @returns Document dimensions information
 */
export function getDocumentDimensions(iframe: HTMLIFrameElement): DocumentDimensions {
  const doc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  
  return {
    iframeWidth: iframe.offsetWidth,
    iframeHeight: iframe.offsetHeight,
    documentWidth: doc.documentElement.offsetWidth,
    documentHeight: doc.documentElement.offsetHeight,
    viewportWidth: win.innerWidth,
    viewportHeight: win.innerHeight,
    scrollWidth: doc.documentElement.scrollWidth,
    scrollHeight: doc.documentElement.scrollHeight,
    clientWidth: doc.documentElement.clientWidth,
    clientHeight: doc.documentElement.clientHeight
  };
}

/**
 * Compares dimensions between two iframes
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function compareIframeDimensions(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const dims1 = getDocumentDimensions(iframe1);
  const dims2 = getDocumentDimensions(iframe2);
  
  console.log('🔍 Iframe Dimension Comparison:');
  console.log('Iframe 1 (Source):', dims1);
  console.log('Iframe 2 (Player):', dims2);
  
  const differences = [];
  for (const [key, value1] of Object.entries(dims1)) {
    const value2 = dims2[key as keyof DocumentDimensions];
    if (value1 !== value2) {
      differences.push(`${key}: ${value1} vs ${value2} (diff: ${value1 - value2})`);
    }
  }
  
  if (differences.length > 0) {
    console.log('📏 Dimension Differences:');
    differences.forEach(diff => console.log('  ', diff));
  } else {
    console.log('✅ No dimension differences found');
  }
}

/**
 * Compares DOM content and structure between two elements
 * @param element1 - First element
 * @param element2 - Second element
 * @param path - Current element path
 */
export function compareDomContent(element1: Element, element2: Element, path: string = 'root'): void {
  console.log(`🔍 Comparing DOM content at: ${path}`);
  
  // Compare text content
  const text1 = element1.textContent?.trim() || '';
  const text2 = element2.textContent?.trim() || '';
  
  if (text1 !== text2) {
    console.log(`📝 Text content difference at ${path}:`);
    console.log(`  Doc1: "${text1}"`);
    console.log(`  Doc2: "${text2}"`);
  }
  
  // Compare child count
  const children1 = Array.from(element1.children);
  const children2 = Array.from(element2.children);
  
  if (children1.length !== children2.length) {
    console.log(`👥 Child count difference at ${path}: ${children1.length} vs ${children2.length}`);
  }
  
  // Compare each child recursively
  const maxChildren = Math.max(children1.length, children2.length);
  for (let i = 0; i < maxChildren; i++) {
    const child1 = children1[i];
    const child2 = children2[i];
    
    if (!child1 || !child2) {
      console.log(`❌ Missing child at ${path} > child[${i}]:`);
      console.log(`  Doc1: ${child1 ? child1.tagName : 'MISSING'}`);
      console.log(`  Doc2: ${child2 ? child2.tagName : 'MISSING'}`);
      continue;
    }
    
    const childPath = `${path} > ${child1.tagName.toLowerCase()}:nth-child(${i + 1})`;
    compareDomContent(child1, child2, childPath);
  }
}

/**
 * Compares specific CSS properties that affect height calculations
 * @param element1 - First element
 * @param element2 - Second element
 * @param path - Current element path
 */
export function compareHeightAffectingStyles(element1: Element, element2: Element, path: string = 'root'): void {
  const styles1 = window.getComputedStyle(element1);
  const styles2 = window.getComputedStyle(element2);
  
  // Properties that affect height calculations
  const heightProperties = [
    'height', 'min-height', 'max-height',
    'line-height', 'font-size', 'font-family',
    'margin-top', 'margin-bottom', 'padding-top', 'padding-bottom',
    'border-top-width', 'border-bottom-width',
    'box-sizing', 'display', 'position',
    'overflow', 'vertical-align'
  ];
  
  const differences: string[] = [];
  
  for (const property of heightProperties) {
    const value1 = styles1.getPropertyValue(property);
    const value2 = styles2.getPropertyValue(property);
    
    if (value1 !== value2) {
      differences.push(`${property}: "${value1}" vs "${value2}"`);
    }
  }
  
  if (differences.length > 0) {
    console.log(`📏 Height-affecting style differences at ${path}:`);
    differences.forEach(diff => console.log(`  ${diff}`));
  }
  
  // Recursively check children
  const children1 = Array.from(element1.children);
  const children2 = Array.from(element2.children);
  
  for (let i = 0; i < Math.min(children1.length, children2.length); i++) {
    const childPath = `${path} > ${children1[i].tagName.toLowerCase()}:nth-child(${i + 1})`;
    compareHeightAffectingStyles(children1[i], children2[i], childPath);
  }
}

/**
 * Inspects the actual rendered content and dimensions of elements
 * @param element1 - First element
 * @param element2 - Second element
 * @param path - Current element path
 */
export function inspectElementRendering(element1: Element, element2: Element, path: string = 'root'): void {
  const rect1 = element1.getBoundingClientRect();
  const rect2 = element2.getBoundingClientRect();
  
  // Check if this element has height differences
  if (Math.abs(rect1.height - rect2.height) > 0.1) {
    console.log(`🔍 Height difference found at ${path}:`);
    console.log(`  Element 1: ${rect1.height}px (${(element1 as HTMLElement).offsetHeight}px offsetHeight)`);
    console.log(`  Element 2: ${rect2.height}px (${(element2 as HTMLElement).offsetHeight}px offsetHeight)`);
    console.log(`  Difference: ${rect1.height - rect2.height}px`);
    
    // Inspect child elements to find the source of the difference
    const children1 = Array.from(element1.children);
    const children2 = Array.from(element2.children);
    
    if (children1.length === children2.length) {
      console.log(`  Inspecting ${children1.length} children...`);
      for (let i = 0; i < children1.length; i++) {
        const childRect1 = children1[i].getBoundingClientRect();
        const childRect2 = children2[i].getBoundingClientRect();
        
        if (Math.abs(childRect1.height - childRect2.height) > 0.1) {
          console.log(`    Child ${i + 1} (${children1[i].tagName}): ${childRect1.height}px vs ${childRect2.height}px (diff: ${childRect1.height - childRect2.height}px)`);
        }
      }
    }
  }
  
  // Recursively check children
  const children1 = Array.from(element1.children);
  const children2 = Array.from(element2.children);
  
  for (let i = 0; i < Math.min(children1.length, children2.length); i++) {
    const childPath = `${path} > ${children1[i].tagName.toLowerCase()}:nth-child(${i + 1})`;
    inspectElementRendering(children1[i], children2[i], childPath);
  }
}

/**
 * Specifically inspects the bg-image-container to identify height differences
 * @param element1 - First element
 * @param element2 - Second element
 */
export function inspectBgImageContainer(element1: Element, element2: Element): void {
  // Find bg-image-container elements
  const container1 = element1.querySelector('.bg-image-container');
  const container2 = element2.querySelector('.bg-image-container');
  
  if (!container1 || !container2) {
    console.log('❌ bg-image-container not found in one or both documents');
    return;
  }
  
  console.log('🔍 Detailed bg-image-container inspection:');
  
  // Compare container styles
  const styles1 = window.getComputedStyle(container1);
  const styles2 = window.getComputedStyle(container2);
  
  const importantProps = ['display', 'width', 'height', 'box-sizing', 'margin', 'padding', 'border'];
  for (const prop of importantProps) {
    const value1 = styles1.getPropertyValue(prop);
    const value2 = styles2.getPropertyValue(prop);
    if (value1 !== value2) {
      console.log(`  ${prop}: "${value1}" vs "${value2}"`);
    }
  }
  
  // Compare child elements in detail
  const children1 = Array.from(container1.children);
  const children2 = Array.from(container2.children);
  
  console.log(`  Children count: ${children1.length} vs ${children2.length}`);
  
  for (let i = 0; i < Math.min(children1.length, children2.length); i++) {
    const child1 = children1[i];
    const child2 = children2[i];
    
    const childRect1 = child1.getBoundingClientRect();
    const childRect2 = child2.getBoundingClientRect();
    
    console.log(`  Child ${i + 1} (${child1.tagName}):`);
    console.log(`    Height: ${childRect1.height}px vs ${childRect2.height}px`);
    console.log(`    Width: ${childRect1.width}px vs ${childRect2.width}px`);
    console.log(`    Top: ${childRect1.top}px vs ${childRect2.top}px`);
    console.log(`    Bottom: ${childRect1.bottom}px vs ${childRect2.bottom}px`);
    
    // Check if this child has different styles
    const childStyles1 = window.getComputedStyle(child1);
    const childStyles2 = window.getComputedStyle(child2);
    
    const childProps = ['display', 'width', 'height', 'margin', 'padding', 'border'];
    for (const prop of childProps) {
      const value1 = childStyles1.getPropertyValue(prop);
      const value2 = childStyles2.getPropertyValue(prop);
      if (value1 !== value2) {
        console.log(`    ${prop}: "${value1}" vs "${value2}"`);
      }
    }
  }
}

/**
 * Checks for missing text nodes or whitespace that might affect layout
 * @param element1 - First element
 * @param element2 - Second element
 * @param path - Current element path
 */
export function checkForMissingContent(element1: Element, element2: Element, path: string = 'root'): void {
  // Compare text content including whitespace
  const text1 = element1.textContent || '';
  const text2 = element2.textContent || '';
  
  if (text1 !== text2) {
    console.log(`📝 Text content difference at ${path}:`);
    console.log(`  Doc1: "${text1}"`);
    console.log(`  Doc2: "${text2}"`);
    console.log(`  Length: ${text1.length} vs ${text2.length}`);
  }
  
  // Compare child nodes (including text nodes)
  const nodes1 = Array.from(element1.childNodes);
  const nodes2 = Array.from(element2.childNodes);
  
  if (nodes1.length !== nodes2.length) {
    console.log(`👥 Node count difference at ${path}: ${nodes1.length} vs ${nodes2.length}`);
    
    // Check what's missing
    for (let i = 0; i < Math.max(nodes1.length, nodes2.length); i++) {
      const node1 = nodes1[i];
      const node2 = nodes2[i];
      
      if (!node1 || !node2) {
        console.log(`  Missing node at index ${i}:`);
        console.log(`    Doc1: ${node1 ? (node1.nodeType === Node.TEXT_NODE ? `TEXT("${node1.textContent}")` : node1.nodeName) : 'MISSING'}`);
        console.log(`    Doc2: ${node2 ? (node2.nodeType === Node.TEXT_NODE ? `TEXT("${node2.textContent}")` : node2.nodeName) : 'MISSING'}`);
      }
    }
  }
  
  // Recursively check children
  const children1 = Array.from(element1.children);
  const children2 = Array.from(element2.children);
  
  for (let i = 0; i < Math.min(children1.length, children2.length); i++) {
    const childPath = `${path} > ${children1[i].tagName.toLowerCase()}:nth-child(${i + 1})`;
    checkForMissingContent(children1[i], children2[i], childPath);
  }
}

/**
 * Specifically checks the text content of the bg-image-container
 * @param element1 - First element
 * @param element2 - Second element
 */
export function checkBgImageContainerText(element1: Element, element2: Element): void {
  const container1 = element1.querySelector('.bg-image-container');
  const container2 = element2.querySelector('.bg-image-container');
  
  if (!container1 || !container2) {
    console.log('❌ bg-image-container not found');
    return;
  }
  
  console.log('🔍 bg-image-container text content check:');
  
  // Check container text content
  const text1 = container1.textContent || '';
  const text2 = container2.textContent || '';
  
  if (text1 !== text2) {
    console.log('📝 Container text content difference:');
    console.log(`  Doc1: "${text1}"`);
    console.log(`  Doc2: "${text2}"`);
    console.log(`  Length: ${text1.length} vs ${text2.length}`);
  }
  
  // Check each child's text content
  const children1 = Array.from(container1.children);
  const children2 = Array.from(container2.children);
  
  for (let i = 0; i < Math.min(children1.length, children2.length); i++) {
    const child1 = children1[i];
    const child2 = children2[i];
    
    const childText1 = child1.textContent || '';
    const childText2 = child2.textContent || '';
    
    if (childText1 !== childText2) {
      console.log(`📝 Child ${i + 1} (${child1.tagName}) text difference:`);
      console.log(`  Doc1: "${childText1}"`);
      console.log(`  Doc2: "${childText2}"`);
      console.log(`  Length: ${childText1.length} vs ${childText2.length}`);
    }
  }
  
  // Check for text nodes between children
  const nodes1 = Array.from(container1.childNodes);
  const nodes2 = Array.from(container2.childNodes);
  
  console.log(`📊 Node count: ${nodes1.length} vs ${nodes2.length}`);
  
  for (let i = 0; i < Math.max(nodes1.length, nodes2.length); i++) {
    const node1 = nodes1[i];
    const node2 = nodes2[i];
    
    if (!node1 || !node2) {
      console.log(`❌ Missing node at index ${i}:`);
      console.log(`  Doc1: ${node1 ? (node1.nodeType === Node.TEXT_NODE ? `TEXT("${node1.textContent}")` : node1.nodeName) : 'MISSING'}`);
      console.log(`  Doc2: ${node2 ? (node2.nodeType === Node.TEXT_NODE ? `TEXT("${node2.textContent}")` : node2.nodeName) : 'MISSING'}`);
    } else if (node1.nodeType === Node.TEXT_NODE || node2.nodeType === Node.TEXT_NODE) {
      const text1 = node1.nodeType === Node.TEXT_NODE ? node1.textContent || '' : '';
      const text2 = node2.nodeType === Node.TEXT_NODE ? node2.textContent || '' : '';
      
      if (text1 !== text2) {
        console.log(`📝 Text node difference at index ${i}:`);
        console.log(`  Doc1: "${text1}"`);
        console.log(`  Doc2: "${text2}"`);
      }
    }
  }
}

/**
 * Compares CSS inheritance and default styles between two iframes
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function compareCssInheritance(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  
  console.log('🔍 CSS Inheritance Comparison:');
  
  // Compare document-level styles
  const styles1 = window.getComputedStyle(doc1.documentElement);
  const styles2 = window.getComputedStyle(doc2.documentElement);
  
  const importantProps = ['font-family', 'font-size', 'line-height', 'margin', 'padding', 'box-sizing'];
  for (const prop of importantProps) {
    const value1 = styles1.getPropertyValue(prop);
    const value2 = styles2.getPropertyValue(prop);
    if (value1 !== value2) {
      console.log(`  html ${prop}: "${value1}" vs "${value2}"`);
    }
  }
  
  // Compare body styles
  const body1 = doc1.body;
  const body2 = doc2.body;
  
  if (body1 && body2) {
    const bodyStyles1 = window.getComputedStyle(body1);
    const bodyStyles2 = window.getComputedStyle(body2);
    
    for (const prop of importantProps) {
      const value1 = bodyStyles1.getPropertyValue(prop);
      const value2 = bodyStyles2.getPropertyValue(prop);
      if (value1 !== value2) {
        console.log(`  body ${prop}: "${value1}" vs "${value2}"`);
      }
    }
  }
  
  // Compare stylesheet count
  const sheets1 = doc1.styleSheets.length;
  const sheets2 = doc2.styleSheets.length;
  
  if (sheets1 !== sheets2) {
    console.log(`  Stylesheet count: ${sheets1} vs ${sheets2}`);
  }
  
  // Compare adopted stylesheets
  const adopted1 = doc1.adoptedStyleSheets.length;
  const adopted2 = doc2.adoptedStyleSheets.length;
  
  if (adopted1 !== adopted2) {
    console.log(`  Adopted stylesheet count: ${adopted1} vs ${adopted2}`);
  }
}

/**
 * Specifically checks adopted stylesheets in both iframes
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function checkAdoptedStyleSheets(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  
  console.log('🔍 Adopted Stylesheet Check:');
  
  const adopted1 = doc1.adoptedStyleSheets;
  const adopted2 = doc2.adoptedStyleSheets;
  
  console.log(`  Adopted stylesheet count: ${adopted1.length} vs ${adopted2.length}`);
  
  // List all adopted stylesheets and their rules
  console.log('  Adopted stylesheets in Doc1:');
  for (let i = 0; i < adopted1.length; i++) {
    const sheet = adopted1[i];
    console.log(`    ${i}: ${sheet.rules.length} rules`);
    try {
      for (let j = 0; j < sheet.rules.length; j++) {
        const rule = sheet.rules[j];
        console.log(`      Rule ${j}: ${rule.cssText}`);
      }
    } catch (e) {
      console.log(`      Cannot access rules: ${e.message}`);
    }
  }
  
  console.log('  Adopted stylesheets in Doc2:');
  for (let i = 0; i < adopted2.length; i++) {
    const sheet = adopted2[i];
    console.log(`    ${i}: ${sheet.rules.length} rules`);
    try {
      for (let j = 0; j < sheet.rules.length; j++) {
        const rule = sheet.rules[j];
        console.log(`      Rule ${j}: ${rule.cssText}`);
      }
    } catch (e) {
      console.log(`      Cannot access rules: ${e.message}`);
    }
  }
  
  // Check if the adopted stylesheet is working by looking at the element
  const element1 = doc1.querySelector('.adopted-style-sheet');
  const element2 = doc2.querySelector('.adopted-style-sheet');
  
  if (element1 && element2) {
    const styles1 = window.getComputedStyle(element1);
    const styles2 = window.getComputedStyle(element2);
    
    console.log('  .adopted-style-sheet element styles:');
    console.log(`    Doc1 background-color: "${styles1.getPropertyValue('background-color')}"`);
    console.log(`    Doc2 background-color: "${styles2.getPropertyValue('background-color')}"`);
    console.log(`    Doc1 color: "${styles1.getPropertyValue('color')}"`);
    console.log(`    Doc2 color: "${styles2.getPropertyValue('color')}"`);
  } else {
    console.log('  .adopted-style-sheet element not found in one or both documents');
  }
  
  // List all stylesheets
  console.log('  All stylesheets in Doc1:');
  for (let i = 0; i < doc1.styleSheets.length; i++) {
    const sheet = doc1.styleSheets[i];
    console.log(`    ${i}: ${sheet.href || 'inline/constructed'}`);
  }
  
  console.log('  All stylesheets in Doc2:');
  for (let i = 0; i < doc2.styleSheets.length; i++) {
    const sheet = doc2.styleSheets[i];
    console.log(`    ${i}: ${sheet.href || 'inline/constructed'}`);
  }
}

/**
 * Compares default browser styles and computed styles of key elements
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function compareDefaultStyles(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  
  console.log('🔍 Default Browser Styles Comparison:');
  
  // Compare html element default styles
  const html1 = doc1.documentElement;
  const html2 = doc2.documentElement;
  
  const htmlStyles1 = window.getComputedStyle(html1);
  const htmlStyles2 = window.getComputedStyle(html2);
  
  const criticalProps = [
    'font-family', 'font-size', 'line-height', 'font-weight',
    'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
    'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
    'box-sizing', 'display', 'writing-mode', 'direction'
  ];
  
  console.log('  HTML element differences:');
  let htmlDiffs = 0;
  for (const prop of criticalProps) {
    const value1 = htmlStyles1.getPropertyValue(prop);
    const value2 = htmlStyles2.getPropertyValue(prop);
    if (value1 !== value2) {
      console.log(`    ${prop}: "${value1}" vs "${value2}"`);
      htmlDiffs++;
    }
  }
  if (htmlDiffs === 0) {
    console.log('    No differences found');
  }
  
  // Compare body element default styles
  const body1 = doc1.body;
  const body2 = doc2.body;
  
  if (body1 && body2) {
    const bodyStyles1 = window.getComputedStyle(body1);
    const bodyStyles2 = window.getComputedStyle(body2);
    
    console.log('  BODY element differences:');
    let bodyDiffs = 0;
    for (const prop of criticalProps) {
      const value1 = bodyStyles1.getPropertyValue(prop);
      const value2 = bodyStyles2.getPropertyValue(prop);
      if (value1 !== value2) {
        console.log(`    ${prop}: "${value1}" vs "${value2}"`);
        bodyDiffs++;
      }
    }
    if (bodyDiffs === 0) {
      console.log('    No differences found');
    }
  }
}

/**
 * Compares computed styles of specific elements that have positioning differences
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function compareProblematicElements(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  
  console.log('🔍 Problematic Elements Analysis:');
  
  // Find the bg-image-container and analyze its children
  const container1 = doc1.querySelector('.bg-image-container');
  const container2 = doc2.querySelector('.bg-image-container');
  
  if (!container1 || !container2) {
    console.log('  bg-image-container not found');
    return;
  }
  
  const children1 = Array.from(container1.children);
  const children2 = Array.from(container2.children);
  
  // Focus on the elements where positioning differences start (Child 3 and 5)
  const problematicIndices = [2, 4]; // Child 3 and Child 5 (0-indexed)
  
  for (const index of problematicIndices) {
    if (index < children1.length && index < children2.length) {
      const child1 = children1[index];
      const child2 = children2[index];
      
      console.log(`  Child ${index + 1} (${child1.tagName}) detailed analysis:`);
      
      const styles1 = window.getComputedStyle(child1);
      const styles2 = window.getComputedStyle(child2);
      
      // Check all properties that could affect positioning
      const positioningProps = [
        'display', 'position', 'float', 'clear',
        'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
        'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
        'border-width', 'border-top-width', 'border-bottom-width',
        'line-height', 'font-size', 'font-family', 'font-weight',
        'vertical-align', 'text-align', 'white-space',
        'box-sizing', 'overflow', 'width', 'height', 'min-height', 'max-height'
      ];
      
      let differences = 0;
      for (const prop of positioningProps) {
        const value1 = styles1.getPropertyValue(prop);
        const value2 = styles2.getPropertyValue(prop);
        if (value1 !== value2) {
          console.log(`    ${prop}: "${value1}" vs "${value2}"`);
          differences++;
        }
      }
      
      if (differences === 0) {
        console.log('    No style differences found');
      }
      
      // Check the element's position relative to its parent
      const rect1 = child1.getBoundingClientRect();
      const rect2 = child2.getBoundingClientRect();
      const containerRect1 = container1.getBoundingClientRect();
      const containerRect2 = container2.getBoundingClientRect();
      
      const relativeTop1 = rect1.top - containerRect1.top;
      const relativeTop2 = rect2.top - containerRect2.top;
      
      console.log(`    Position relative to container: ${relativeTop1.toFixed(2)}px vs ${relativeTop2.toFixed(2)}px (diff: ${(relativeTop1 - relativeTop2).toFixed(2)}px)`);
    }
  }
  
  // Check if there are any elements before the problematic ones that might be causing the shift
  console.log('  Elements before problematic ones:');
  for (let i = 0; i < 3 && i < children1.length; i++) {
    const child1 = children1[i];
    const child2 = children2[i];
    
    const rect1 = child1.getBoundingClientRect();
    const rect2 = child2.getBoundingClientRect();
    
    if (Math.abs(rect1.height - rect2.height) > 0.1) {
      console.log(`    Child ${i + 1} height difference: ${rect1.height.toFixed(2)}px vs ${rect2.height.toFixed(2)}px`);
    }
  }
}

/**
 * Investigates timing and rendering context differences
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function investigateRenderingContext(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  const win1 = iframe1.contentWindow!;
  const win2 = iframe2.contentWindow!;
  
  console.log('🔍 Rendering Context Investigation:');
  
  // Check document ready state
  console.log(`  Document ready state: "${doc1.readyState}" vs "${doc2.readyState}"`);
  
  // Check if fonts are loaded
  if ('fonts' in doc1 && 'fonts' in doc2) {
    console.log(`  Fonts ready: ${doc1.fonts.ready === doc1.fonts.ready} vs ${doc2.fonts.ready === doc2.fonts.ready}`);
    console.log(`  Fonts status: ${doc1.fonts.status} vs ${doc2.fonts.status}`);
  }
  
  // Check viewport and window properties
  console.log('  Window properties:');
  const windowProps = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio'];
  for (const prop of windowProps) {
    const value1 = (win1 as any)[prop];
    const value2 = (win2 as any)[prop];
    if (value1 !== value2) {
      console.log(`    ${prop}: ${value1} vs ${value2}`);
    }
  }
  
  // Check document properties
  console.log('  Document properties:');
  const docProps = ['compatMode', 'designMode', 'dir', 'characterSet'];
  for (const prop of docProps) {
    const value1 = (doc1 as any)[prop];
    const value2 = (doc2 as any)[prop];
    if (value1 !== value2) {
      console.log(`    ${prop}: "${value1}" vs "${value2}"`);
    }
  }
  
  // Check if images are loaded
  const images1 = Array.from(doc1.querySelectorAll('img'));
  const images2 = Array.from(doc2.querySelectorAll('img'));
  
  console.log('  Image loading status:');
  console.log(`    Doc1 images: ${images1.length} total`);
  images1.forEach((img, i) => {
    console.log(`      Image ${i}: complete=${img.complete}, naturalWidth=${img.naturalWidth}`);
  });
  
  console.log(`    Doc2 images: ${images2.length} total`);
  images2.forEach((img, i) => {
    console.log(`      Image ${i}: complete=${img.complete}, naturalWidth=${img.naturalWidth}`);
  });
}

/**
 * Checks for font loading differences that might affect layout
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function checkFontLoading(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  
  console.log('🔍 Font Loading Analysis:');
  
  // Check computed font properties on key elements
  const testElements = [
    doc1.body,
    doc1.querySelector('h1'),
    doc1.querySelector('h2'),
    doc1.querySelector('.bg-image-container')
  ];
  
  const testElements2 = [
    doc2.body,
    doc2.querySelector('h1'),
    doc2.querySelector('h2'),
    doc2.querySelector('.bg-image-container')
  ];
  
  const fontProps = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'];
  
  for (let i = 0; i < testElements.length; i++) {
    const elem1 = testElements[i];
    const elem2 = testElements2[i];
    
    if (elem1 && elem2) {
      const styles1 = window.getComputedStyle(elem1);
      const styles2 = window.getComputedStyle(elem2);
      
      console.log(`  Element ${i} (${elem1.tagName || 'BODY'}) font properties:`);
      let hasDifferences = false;
      
      for (const prop of fontProps) {
        const value1 = styles1.getPropertyValue(prop);
        const value2 = styles2.getPropertyValue(prop);
        if (value1 !== value2) {
          console.log(`    ${prop}: "${value1}" vs "${value2}"`);
          hasDifferences = true;
        }
      }
      
      if (!hasDifferences) {
        console.log('    No font differences found');
      }
    }
  }
  
  // Check if fonts are still loading
  if ('fonts' in doc1 && 'fonts' in doc2) {
    Promise.all([doc1.fonts.ready, doc2.fonts.ready]).then(() => {
      console.log('  All fonts loaded in both documents');
    }).catch(() => {
      console.log('  Font loading issues detected');
    });
  }
}

/**
 * Investigates timing-related layout differences
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function checkTimingIssues(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  console.log('🔍 Timing Issues Investigation:');
  
  // Force layout recalculation and measure again
  const container1 = iframe1.contentDocument!.querySelector('.bg-image-container');
  const container2 = iframe2.contentDocument!.querySelector('.bg-image-container');
  
  if (container1 && container2) {
    // Force reflow
    container1.offsetHeight;
    container2.offsetHeight;
    
    // Wait a bit and measure again
    setTimeout(() => {
      const children1 = Array.from(container1.children);
      const children2 = Array.from(container2.children);
      
      console.log('  After forced reflow:');
      for (let i = 2; i < 5 && i < children1.length; i++) { // Check problematic children
        const rect1 = children1[i].getBoundingClientRect();
        const rect2 = children2[i].getBoundingClientRect();
        const containerRect1 = container1.getBoundingClientRect();
        const containerRect2 = container2.getBoundingClientRect();
        
        const relativeTop1 = rect1.top - containerRect1.top;
        const relativeTop2 = rect2.top - containerRect2.top;
        
        console.log(`    Child ${i + 1}: ${relativeTop1.toFixed(2)}px vs ${relativeTop2.toFixed(2)}px (diff: ${(relativeTop1 - relativeTop2).toFixed(2)}px)`);
      }
    }, 100);
  }
}

/**
 * Investigates DOCTYPE and document structure differences
 * @param iframe1 - First iframe
 * @param iframe2 - Second iframe
 */
export function investigateDocumentStructure(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  
  console.log('🔍 Document Structure Investigation:');
  
  // Check DOCTYPE
  console.log('  DOCTYPE comparison:');
  console.log(`    Doc1 DOCTYPE: ${doc1.doctype ? `<!DOCTYPE ${doc1.doctype.name}>` : 'MISSING'}`);
  console.log(`    Doc2 DOCTYPE: ${doc2.doctype ? `<!DOCTYPE ${doc2.doctype.name}>` : 'MISSING'}`);
  
  if (doc1.doctype && doc2.doctype) {
    console.log(`    Doc1 publicId: "${doc1.doctype.publicId}"`);
    console.log(`    Doc2 publicId: "${doc2.doctype.publicId}"`);
    console.log(`    Doc1 systemId: "${doc1.doctype.systemId}"`);
    console.log(`    Doc2 systemId: "${doc2.doctype.systemId}"`);
  }
  
  // Check document children structure
  console.log('  Document children:');
  console.log(`    Doc1 children: ${doc1.childNodes.length}`);
  for (let i = 0; i < doc1.childNodes.length; i++) {
    const node = doc1.childNodes[i];
    console.log(`      ${i}: ${node.nodeType} (${node.nodeName})`);
  }
  
  console.log(`    Doc2 children: ${doc2.childNodes.length}`);
  for (let i = 0; i < doc2.childNodes.length; i++) {
    const node = doc2.childNodes[i];
    console.log(`      ${i}: ${node.nodeType} (${node.nodeName})`);
  }
  
  // Check compatibility mode again for confirmation
  console.log('  Compatibility mode:');
  console.log(`    Doc1: ${doc1.compatMode}`);
  console.log(`    Doc2: ${doc2.compatMode}`);
}

/**
 * Attempts to fix the compatibility mode issue by ensuring proper DOCTYPE
 * @param iframe1 - First iframe  
 * @param iframe2 - Second iframe
 */
export function attemptCompatibilityModeFix(iframe1: HTMLIFrameElement, iframe2: HTMLIFrameElement): void {
  const doc1 = iframe1.contentDocument!;
  const doc2 = iframe2.contentDocument!;
  
  console.log('🔧 Attempting Compatibility Mode Fix:');
  
  // Check if we can force standards mode
  if (doc2.compatMode === 'BackCompat') {
    console.log('  Player iframe is in BackCompat mode, attempting fix...');
    
    // Try to add DOCTYPE if missing
    if (!doc2.doctype) {
      console.log('  Adding DOCTYPE to player iframe...');
      const doctype = doc2.implementation.createDocumentType('html', '', '');
      doc2.insertBefore(doctype, doc2.firstChild);
      console.log(`  After DOCTYPE addition: ${doc2.compatMode}`);
    }
    
    // If that doesn't work, we need to recreate the document
    if (doc2.compatMode === 'BackCompat') {
      console.log('  DOCTYPE addition failed, compatibility mode cannot be changed after document creation');
      console.log('  The iframe needs to be initialized with proper DOCTYPE from the start');
    }
  }
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
