import { Frame, Writer } from "@domcorder/proto-ts";

export type FrameChunkWriterHandler = {
  next: (chunk: Uint8Array) => void;
  error: (error: Error) => void;
  cancelled: (reason: any) => void;
  done: () => void;
}

export type FrameChunkWriterOptions = {
  chunkSize?: number;
  writerFactory?: () => [Writer, ReadableStream<Uint8Array>];
}

export class FrameChunkWriter {

  private readonly handler: FrameChunkWriterHandler;
  private readonly writer: Writer;
  private readonly stream: ReadableStream<Uint8Array>;

  constructor(
    handler: FrameChunkWriterHandler,
    options: FrameChunkWriterOptions = {}
  ) {
    const [writer, stream] = options?.writerFactory ? 
      options.writerFactory() : 
      Writer.create(options?.chunkSize ?? 512 * 1024);

    this.writer = writer;
    this.stream = stream;
    this.handler = handler;

    void this.start();
  }

  public async write(frame: Frame): Promise<void> {
    return frame.encode(this.writer);
  }

  private async start(): Promise<void> {
    try {
      const reader = this.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.handler.done();
          break;
        }

        if (value) {
          this.handler.next(value);
        }
      }

    } catch (error) {
      this.handler.error(error as Error);
    }
  }
}