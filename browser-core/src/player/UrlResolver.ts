/**
 * URL Resolver for asset playback
 * 
 * Resolves asset random IDs (retrieval tokens) to HTTP URLs based on storage backend configuration.
 * This enables late-binding of URLs, allowing the same recording to work with different
 * storage backends (local filesystem, S3, etc.).
 */

export interface UrlResolver {
  resolveUrl(hash: string): string;
}

/**
 * Local filesystem URL resolver
 * 
 * Resolves hashes to HTTP URLs on the local server (e.g., /assets/{hash})
 */
export class LocalUrlResolver implements UrlResolver {
  private readonly baseUrl: string;

  constructor(config: { base_url: string }) {
    this.baseUrl = config.base_url;
  }

  resolveUrl(hash: string): string {
    if (!hash || hash.length === 0) {
      throw new Error('Hash cannot be empty');
    }
    // Remove leading slash from baseUrl if present, then add /assets/{hash}
    const base = this.baseUrl.replace(/\/$/, '');
    return `${base}/assets/${hash}`;
  }
}

/**
 * Factory function to create a UrlResolver based on storage type
 */
export function createUrlResolver(storageType: string, configJson: string): UrlResolver {
  const config = JSON.parse(configJson);
  
  switch (storageType) {
    case 'local':
      return new LocalUrlResolver(config);
    default:
      throw new Error(`Unknown storage type: ${storageType}`);
  }
}

