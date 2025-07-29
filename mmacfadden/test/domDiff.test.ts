import { diffDom } from '../src/domDiff';
import { JSDOM } from 'jsdom';

function runTest() {
  // Create two DOM trees
  const window = new JSDOM().window;
  const doc1 = new window.DOMParser().parseFromString('<div><span>Hi</span><b></b></div>', 'text/html');
  const doc2 = new window.DOMParser().parseFromString('<div><span>Hello</span><i></i></div>', 'text/html');
  const oldRoot = doc1.body.firstChild!;
  const newRoot = doc2.body.firstChild!;
  const ops = diffDom(oldRoot, newRoot);
  console.log(JSON.stringify(ops, null, 2));
}

runTest(); 