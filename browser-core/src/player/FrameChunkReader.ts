import { Frame, Reader,  } from "@domcorder/proto-ts";
import { Deferred } from "../common/";

export type FrameChunkReaderHandler = {
  next: (frame: Frame) => void;
  error: (error: Error) => void;
  cancelled: (reason: any) => void;
  done: () => void;
}

export class FrameChunkReader {
  private chunkController: ReadableStreamDefaultController<Uint8Array> | null;
  private readonly handler: FrameChunkReaderHandler;
  private readonly frameStream: ReadableStream<Frame>;
  private readonly _ready: Deferred<void>;

  constructor(handler: FrameChunkReaderHandler) {
    this.chunkController = null;
    this.handler = handler;
    this._ready = new Deferred();

    const chunkStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.chunkController = controller;
        this._ready.resolve();
      },
      cancel: (reason) => {
        this.handler.cancelled(reason);
      }
    });

    const [_, frameStream] = Reader.create(chunkStream, false);
    this.frameStream = frameStream;
    void this.start();
  }

  public ready(): boolean {
    return this.chunkController !== null;
  }

  public async whenReady(): Promise<void> {
    return this._ready.promise();
  }

  public close(): void {
    this.frameStream?.cancel();
  }

  public read(chunk: Uint8Array): void {
    if (this.chunkController) {
      this.chunkController.enqueue(chunk);
    } else {
      throw new Error("Can not call read() before ready");
    }
  }

  private async start(): Promise<void> {
    const reader = this.frameStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.chunkController?.close();
          this.handler.done();
          break;
        }

        this.handler.next(value);
      }
    } catch (error) {
      this.handler.error(error as Error);
    } finally {
      reader.releaseLock();
    }
  }
}