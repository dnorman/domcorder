// Stream observer utility for testing
// Eagerly consumes stream data in background and provides analysis

export interface ChunkInfo {
    data: Uint8Array;
    size: number;
    timestamp: number;
}

export interface StreamAnalysis {
    chunks: ChunkInfo[];
    totalBytes: number;
    chunkCount: number;
    averageChunkSize: number;
    minChunkSize: number;
    maxChunkSize: number;
}

export class StreamObserver {
    private chunks: ChunkInfo[] = [];
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private consuming = false;
    private done = false;

    constructor(stream: ReadableStream<Uint8Array>) {
        this.reader = stream.getReader();
        this.startConsuming();
    }

    private async startConsuming(): Promise<void> {
        this.consuming = true;

        try {
            while (true) {
                const { done, value } = await this.reader.read();
                if (done) {
                    this.done = true;
                    break;
                }

                this.chunks.push({
                    data: value,
                    size: value.length,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('Stream observer error:', error);
        } finally {
            this.consuming = false;
            this.reader.releaseLock();
        }
    }

    /** Drain accumulated chunks and return analysis */
    async check(): Promise<StreamAnalysis> {
        // Give microtasks a chance to run (should be enough for stream consumption)
        await new Promise(resolve => setTimeout(resolve, 0));

        const drainedChunks = [...this.chunks];
        this.chunks = []; // Clear the accumulated chunks

        const totalBytes = drainedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
        const chunkSizes = drainedChunks.map(chunk => chunk.size);

        return {
            chunks: drainedChunks,
            totalBytes,
            chunkCount: drainedChunks.length,
            averageChunkSize: drainedChunks.length > 0 ? totalBytes / drainedChunks.length : 0,
            minChunkSize: chunkSizes.length > 0 ? Math.min(...chunkSizes) : 0,
            maxChunkSize: chunkSizes.length > 0 ? Math.max(...chunkSizes) : 0,
        };
    }

    /** Get current chunk count without draining */
    getCurrentChunkCount(): number {
        return this.chunks.length;
    }

    /** Check if stream is done */
    isDone(): boolean {
        return this.done;
    }

    /** Wait for stream to complete */
    async waitForCompletion(): Promise<StreamAnalysis> {
        while (!this.done && this.consuming) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        return this.check();
    }
}

/** Factory function for the preferred usage pattern */
export function streamObserve(stream: ReadableStream<Uint8Array>): () => Promise<StreamAnalysis> {
    const observer = new StreamObserver(stream);
    return () => observer.check();
}

// Frame stream observer for ReadableStream<Frame>
export interface FrameChunkInfo<T = any> {
    data: T;
}

export interface FrameStreamAnalysis<T = any> {
    chunkCount: number;
    chunks: FrameChunkInfo<T>[];
}

export class FrameStreamObserver<T = any> {
    private chunks: FrameChunkInfo<T>[] = [];
    private reader: ReadableStreamDefaultReader<T>;
    private consuming = false;
    private done = false;

    constructor(stream: ReadableStream<T>) {
        this.reader = stream.getReader();
        this.startConsuming();
    }

    private async startConsuming(): Promise<void> {
        this.consuming = true;

        try {
            while (true) {
                const { done, value } = await this.reader.read();
                if (done) {
                    this.done = true;
                    break;
                }

                this.chunks.push({
                    data: value
                });
            }
        } catch (error) {
            console.error('Frame stream observer error:', error);
        } finally {
            this.consuming = false;
            this.reader.releaseLock();
        }
    }

    /** Drain accumulated chunks and return analysis */
    async check(): Promise<FrameStreamAnalysis<T>> {
        // Give microtasks a chance to run (should be enough for stream consumption)
        await new Promise(resolve => setTimeout(resolve, 0));

        const drainedChunks = [...this.chunks];
        this.chunks = []; // Clear the accumulated chunks

        return {
            chunks: drainedChunks,
            chunkCount: drainedChunks.length
        };
    }

    /** Get current chunk count without draining */
    getCurrentChunkCount(): number {
        return this.chunks.length;
    }

    /** Check if stream is done */
    isDone(): boolean {
        return this.done;
    }

    /** Wait for stream to complete */
    async waitForCompletion(): Promise<FrameStreamAnalysis<T>> {
        while (!this.done && this.consuming) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        return this.check();
    }
}

/** Factory function for Frame streams */
export function frameStreamObserve<T = any>(stream: ReadableStream<T>): () => Promise<FrameStreamAnalysis<T>> {
    const observer = new FrameStreamObserver(stream);
    return () => observer.check();
}