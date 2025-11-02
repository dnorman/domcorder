/**
 * Attributes that may contain asset placeholder URLs (asset:N) that need to be
 * resolved to blob URLs by the AssetManager.
 * 
 * These attributes can reference external resources during recording and playback:
 * - src: Images, scripts, iframes, video/audio sources
 * - href: Links, stylesheets
 * - poster: Video poster images
 * - xlink:href: SVG external references
 * - data-src: Lazy-loaded images (common pattern)
 * - srcset: Responsive image sources
 * - style: Inline styles with url() references
 */
export const ASSET_CONTAINING_ATTRIBUTES: readonly string[] = [
  'src',
  'href', 
  'poster',
  'xlink:href',
  'data-src',
  'srcset',
  'style'
];

