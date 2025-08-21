import { JSDOM } from 'jsdom';

// Create a JSDOM instance
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});

// Set up global variables for Bun
Object.defineProperty(globalThis, 'document', {
  value: dom.window.document,
  writable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: dom.window,
  writable: true,
});

Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
});

Object.defineProperty(globalThis, 'HTMLElement', {
  value: dom.window.HTMLElement,
  writable: true,
});

Object.defineProperty(globalThis, 'Element', {
  value: dom.window.Element,
  writable: true,
});

Object.defineProperty(globalThis, 'Node', {
  value: dom.window.Node,
  writable: true,
});

Object.defineProperty(globalThis, 'Text', {
  value: dom.window.Text,
  writable: true,
});

Object.defineProperty(globalThis, 'DocumentFragment', {
  value: dom.window.DocumentFragment,
  writable: true,
});

Object.defineProperty(globalThis, 'Comment', {
  value: dom.window.Comment,
  writable: true,
});

Object.defineProperty(globalThis, 'DOMParser', {
  value: dom.window.DOMParser,
  writable: true,
});

Object.defineProperty(globalThis, 'XMLSerializer', {
  value: dom.window.XMLSerializer,
  writable: true,
});

Object.defineProperty(globalThis, 'MutationObserver', {
  value: dom.window.MutationObserver,
  writable: true,
});

Object.defineProperty(globalThis, 'setTimeout', {
  value: dom.window.setTimeout,
  writable: true,
});

Object.defineProperty(globalThis, 'clearTimeout', {
  value: dom.window.clearTimeout,
  writable: true,
});

// Mock console methods to avoid noise in tests
Object.defineProperty(globalThis, 'console', {
  value: {
    ...console,
    error: () => {},
    warn: () => {},
    log: () => {},
  },
  writable: true,
});
