import { Frame, RecordingMetadata, AssetReference, Asset, CacheManifest as ProtoCacheManifest, Heartbeat } from "@domcorder/proto-ts";
import type { FrameHandler, PageRecorder } from "./PageRecorder";
import { FrameChunkWriter } from "./FrameChunkWriter";
import { sha256 } from "../common/hash";
import { SimpleBufferReader } from "../common/SimpleBufferReader";

export type PageRecordingClientOptions = {
  chunkSize?: number;
  webSocketFactory?: (serverUrl: string) => WebSocket;
}

// Cache manifest entry from server
interface ManifestEntry {
  url: string;
  sha256_hash: string;
}

interface CacheManifest {
  assets: ManifestEntry[];
}

export class PageRecordingClient {
  private readonly recorder: PageRecorder;
  private readonly frameHandler: FrameHandler;
  private readonly serverUrl: string;
  private readonly frameQueue: Frame[];
  private readonly options: PageRecordingClientOptions;

  private ws: WebSocket | null;
  private isProcessingQueue: boolean;
  private frameChunkWriter: FrameChunkWriter | null;
  
  // Cache manifest: maps SHA-256 hash to URL
  private cacheManifest: Map<string, string> = new Map();
  private metadataSent: boolean = false;
  
  // Heartbeat management
  private heartbeatTimer: number | null = null;
  private heartbeatIntervalSeconds: number = 0;

  constructor(recorder: PageRecorder, serverUrl: string, options: PageRecordingClientOptions = {}) {
    this.recorder = recorder;
    this.serverUrl = serverUrl;
    this.ws = null;
    this.frameQueue = [];
    this.options = options;
    this.isProcessingQueue = false;
    this.frameChunkWriter = null;

    this.frameHandler = async (frame: Frame) => {
      // Always add to queue to maintain order
      this.frameQueue.push(frame);

      // Process queue if not already processing
      if (!this.isProcessingQueue) {
        await this.processFrameQueue();
      }
    };
  }

  public start() {
    this.recorder.addFrameHandler(this.frameHandler);
    this.connectToServer();
  }

  private resetHeartbeatTimer(): void {
    // Clear existing timer
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Don't set timer if heartbeat is disabled
    if (this.heartbeatIntervalSeconds === 0) {
      return;
    }

    // Set new timer
    this.heartbeatTimer = window.setTimeout(() => {
      this.sendHeartbeat();
      // After sending heartbeat, reset timer for next interval
      this.resetHeartbeatTimer();
    }, this.heartbeatIntervalSeconds * 1000);
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const heartbeatFrame = new Heartbeat();
      // Send heartbeat directly without resetting timer (timer is reset in resetHeartbeatTimer after this call)
      if (!this.frameChunkWriter) {
        this.frameChunkWriter = this.createFrameChunkWriter();
      }
      await this.frameChunkWriter.write(heartbeatFrame);
    } catch (error) {
      console.error('Error sending heartbeat:', error);
    }
  }

  public stop() {
    this.recorder.removeFrameHandler(this.frameHandler);
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.ws?.close();
  }

  public getWebSocket(): WebSocket | null {
    return this.ws;
  }

  private createFrameChunkWriter(): FrameChunkWriter {
    return new FrameChunkWriter({
      next: (chunk: Uint8Array) => {
        this.ws?.send(chunk);
      },
      error: (error: Error) => {
        console.error('Error writing frame chunk:', error);
      },
      cancelled: (reason: any) => {
        console.error('Frame chunk writer cancelled:', reason);
      },
      done: () => {

      }
    }, {
      chunkSize: this.options.chunkSize ?? 512 * 1024
    });
  }

  private async sendFrameImmediately(frame: Frame): Promise<void> {
    if (!this.frameChunkWriter) {
      this.frameChunkWriter = this.createFrameChunkWriter();
    }
    await this.frameChunkWriter.write(frame);
    
    // Reset heartbeat timer after sending any frame (except Heartbeat itself)
    // Heartbeat frames reset their own timer in sendHeartbeat()
    if (!(frame instanceof Heartbeat)) {
      this.resetHeartbeatTimer();
    }
  }

  private async processFrameQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return; // Already processing
    }

    this.isProcessingQueue = true;

    try {
      // Create frame chunk writer if not exists
      if (!this.frameChunkWriter) {
        this.frameChunkWriter = this.createFrameChunkWriter();
      }

      while (this.frameQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
        const frame = this.frameQueue.shift()!;
        
        // Check if this is an Asset frame that we can convert to AssetReference
        if (frame instanceof Asset && frame.buf.byteLength > 0) {
          const cachedFrame = await this.checkCacheAndConvert(frame);
          await this.frameChunkWriter.write(cachedFrame);
        } else {
          await this.frameChunkWriter.write(frame);
        }
        
        // Reset heartbeat timer after sending any frame
        this.resetHeartbeatTimer();
      }
    } catch (error) {
      console.error('Error processing frame queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Check if an Asset is in the cache manifest and convert to AssetReference if so
   */
  private async checkCacheAndConvert(asset: Asset): Promise<Frame> {
    try {
      // Compute SHA-256 hash
      const sha256Hash = await sha256(asset.buf);
      
      // Check if hash is in manifest
      if (this.cacheManifest.has(sha256Hash)) {
        console.debug(`♻️  Asset cached: ${asset.url} (sha256=${sha256Hash.substring(0, 16)}...)`);
        // Return AssetReference instead of Asset (using hash field, which contains SHA-256 from client)
        return new AssetReference(asset.asset_id, asset.url, sha256Hash, asset.mime);
      } else {
        // Not cached, send full Asset frame
        return asset;
      }
    } catch (error) {
      console.error('Error checking cache:', error);
      // On error, send the full Asset frame
      return asset;
    }
  }

  private connectToServer(): void {
    try {
      this.ws = this.options.webSocketFactory ?
        this.options.webSocketFactory(this.serverUrl) :
        new WebSocket(this.serverUrl);

      this.ws.onopen = async () => {

        // Send RecordingMetadata frame with initial URL and heartbeat interval
        if (!this.metadataSent) {
          const initialUrl = this.recorder.getInitialUrl?.() || window.location.href;
          const heartbeatInterval = 30; // Default: 30 seconds (can be made configurable)
          const metadataFrame = new RecordingMetadata(initialUrl, heartbeatInterval);
          await this.sendFrameImmediately(metadataFrame);
          this.metadataSent = true;
          this.heartbeatIntervalSeconds = heartbeatInterval;
          this.resetHeartbeatTimer();
        }

        // Start processing any queued frames
        if (this.frameQueue.length > 0 && !this.isProcessingQueue) {
          await this.processFrameQueue();
        }
      };

      this.ws.onmessage = async (event) => {
        const message = event.data;

        // Handle binary messages (frames)
        if (message instanceof ArrayBuffer || message instanceof Uint8Array) {
          try {
            const data = message instanceof ArrayBuffer ? new Uint8Array(message) : message;
            
            // Skip frame length prefix (first 4 bytes) - it's already been consumed by WebSocket
            // The frame format is: [u32 length][frame data]
            // But WebSocket gives us the raw bytes, so we need to check if there's a length prefix
            let frameData = data;
            if (data.length >= 4) {
              // Check if first 4 bytes look like a length prefix (reasonable size)
              const potentialLength = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
              if (potentialLength > 0 && potentialLength < data.length && potentialLength < 10 * 1024 * 1024) {
                // Likely a length prefix, skip it
                frameData = data.slice(4);
              }
            }
            
            const reader = new SimpleBufferReader(frameData);
            
            // Try to decode as a frame
            const frame = Frame.decode(reader);
            
            if (frame instanceof ProtoCacheManifest) {
              // Build hash-to-URL map
              this.cacheManifest.clear();
              for (const entry of frame.assets) {
                this.cacheManifest.set(entry.sha256_hash, entry.url);
              }
              
              console.debug(`📦 Received cache manifest frame with ${frame.assets.length} entries`);
            } else {
              console.debug('📦 Received binary frame (not manifest):', frame?.constructor.name || 'null');
            }
          } catch (error) {
            console.error('Failed to decode binary frame:', error);
          }
        }
        // Text messages are no longer sent by the server
        // If we receive one, it's unexpected
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      this.ws.onclose = () => {
        // WebSocket closed
      };

    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  }
}