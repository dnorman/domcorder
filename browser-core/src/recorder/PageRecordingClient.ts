import { Frame } from "@domcorder/proto-ts";
import type { FrameHandler, PageRecorder } from "./PageRecorder";
import { FrameChunkWriter } from "./FrameChunkWriter";

export type PageRecordingClientOptions = {
  chunkSize?: number;
  webSocketFactory?: (serverUrl: string) => WebSocket;
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

  public stop() {
    this.recorder.removeFrameHandler(this.frameHandler);
    this.ws?.close();
  }

  public getWebSocket(): WebSocket | null {
    return this.ws;
  }

  private createFrameChunkWriter(): FrameChunkWriter {
    return new FrameChunkWriter({
      next: (chunk: Uint8Array) => {
        const beforeBuffer = this.ws?.bufferedAmount || 0;
        console.debug(`📤 Sending binary chunk to server: ${chunk.length} bytes, buffered before: ${beforeBuffer} bytes`);
        this.ws?.send(chunk);
        const afterBuffer = this.ws?.bufferedAmount || 0;
        console.debug(`📊 WebSocket buffer after send: ${afterBuffer} bytes (delta: +${afterBuffer - beforeBuffer})`);

        // Log if buffer is getting large (potential bottleneck)
        if (afterBuffer > 1024 * 1024) { // 1MB threshold
          console.warn(`⚠️ WebSocket buffer is large: ${(afterBuffer / 1024 / 1024).toFixed(2)}MB - network may be slow`);
        }
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
        await this.frameChunkWriter.write(frame);
      }
    } catch (error) {
      console.error('Error processing frame queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private connectToServer(): void {
    console.debug('🔌 Connecting to WebSocket server...');
    try {
      this.ws = this.options.webSocketFactory ?
        this.options.webSocketFactory(this.serverUrl) :
        new WebSocket(this.serverUrl);

      this.ws.onopen = async () => {
        console.debug('🔌 WebSocket connected');

        // Start processing any queued frames
        if (this.frameQueue.length > 0 && !this.isProcessingQueue) {
          await this.processFrameQueue();
        }
      };

      this.ws.onmessage = (event) => {
        console.debug('📨 Server message:', event.data);
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.debug('🔌 WebSocket closed');
      };

    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  }
}