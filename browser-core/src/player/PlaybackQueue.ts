import { Frame, Timestamp } from "@domcorder/proto-ts";

export type PlaybackTimeBucket  = {
  frames: Frame[];
  timestamp: number;
};

export class PlaybackQueue {
  private lastPlayedTimestamp: number;
  private readonly frameQueue: PlaybackTimeBucket[];
  private readonly playbackEpoch: number;

  private nextEventTimeout: number | null;
  private pendingOperation: Promise<void> | null;
  private isProcessingQueue: boolean = false;
  private isProcessingQueuedBuckets: boolean = false;

  private playbackSpeed: number;
  private readonly playbackHandler: (frame: Frame, timestamp: number) => Promise<void>;
  private readonly live: boolean;

  constructor(live: boolean, playbackHandler: (frame: Frame, timestamp: number) => Promise<void>) {
    this.lastPlayedTimestamp = 0;
    this.frameQueue = [];
    this.playbackEpoch = Date.now();
    this.nextEventTimeout = null;
    this.pendingOperation = null;
    this.playbackSpeed = 1;
    this.playbackHandler = playbackHandler;
    this.live = live;
  }

  public enqueueFrame(frame: Frame) {
    if (this.live) {
      // Live mode: process ASAP, preserve timestamp context via buckets
      if (frame instanceof Timestamp) {
        // Update lastPlayedTimestamp and create new bucket
        this.lastPlayedTimestamp = Number(frame.timestamp);
        this.frameQueue.push({ frames: [], timestamp: this.lastPlayedTimestamp });
      } else {
        // Operation frame
        const timestamp = this.getCurrentTimestamp();
        // Only process immediately if ALL of these conditions are met:
        // 1. No operation is pending (pendingOperation === null)
        // 2. Queue is empty (frameQueue.length === 0)
        // 3. Not currently processing queued buckets (isProcessingQueuedBuckets === false)
        // This prevents frames from being processed out of order
        if (this.pendingOperation === null && 
            this.frameQueue.length === 0 && 
            !this.isProcessingQueuedBuckets) {
          // Process immediately - queue is empty and no operation pending
          void this.processFrame(frame, timestamp);
        } else {
          // Queue in most recent bucket (or create one if needed)
          this.ensureBucketForFrame(timestamp);
          const lastBucket = this.frameQueue[this.frameQueue.length - 1];
          lastBucket.frames.push(frame);
          
          // If no operation is pending and not already processing buckets, start processing
          if (this.pendingOperation === null && !this.isProcessingQueuedBuckets) {
            void this.processQueuedBuckets();
          }
        }
      }
    } else {
      // Non-live mode: timestamp-based scheduling
      // Always queue frames to ensure sequential processing and avoid race conditions
      if (frame instanceof Timestamp) {
        // Create new bucket for this timestamp
        this.lastPlayedTimestamp = Number(frame.timestamp);
        this.frameQueue.push({ frames: [], timestamp: this.lastPlayedTimestamp });
        this.setNextEventTimeout();
      } else {
        // Operation frame - always queue it
        const frameTimestamp = this.getCurrentTimestamp();
        
        // Queue the frame
        if (this.frameQueue.length === 0) {
          // Create a bucket with current timestamp
          this.frameQueue.push({ frames: [frame], timestamp: frameTimestamp });
        } else {
          // Add to most recent bucket
          const lastBucket = this.frameQueue[this.frameQueue.length - 1];
          lastBucket.frames.push(frame);
        }
        
        // If no operation is pending and frames are ready, process them
        const currentElapsed = this.getCurrentElapsedTime();
        if (frameTimestamp <= currentElapsed && this.pendingOperation === null) {
          // Process ready buckets immediately
          void this.processFrameQueue();
        } else if (frameTimestamp > currentElapsed) {
          // Schedule processing for future frames
          this.setNextEventTimeout();
        }
      }
    }
  }

  /**
   * Process a single frame with the given timestamp.
   * Ensures sequential execution by chaining to pendingOperation.
   */
  private processFrame(frame: Frame, timestamp: number): void {
    // Capture the current pendingOperation synchronously
    const previousOperation = this.pendingOperation;
    
    // Create the operation promise, chaining to previous if it exists
    const operationPromise = previousOperation
      ? previousOperation.then(() => this.playbackHandler(frame, timestamp))
      : this.playbackHandler(frame, timestamp);

    // Convert to Promise<void> and set pendingOperation IMMEDIATELY (synchronously)
    const voidPromise = operationPromise.then(() => undefined, () => undefined);
    this.pendingOperation = voidPromise;

    // Handle the operation asynchronously
    voidPromise.finally(() => {
      // Clear pendingOperation only if it's still this operation
      if (this.pendingOperation === voidPromise) {
        this.pendingOperation = null;
        
        // After completing, check if there are queued frames to process
        // Call synchronously to prevent race conditions where new frames
        // arrive and process before queued frames
        if (this.live) {
          // Live mode: process all queued buckets immediately
          void this.processQueuedBuckets();
        } else {
          // Non-live mode: process ready buckets
          if (this.frameQueue.length > 0 && this.pendingOperation === null) {
            void this.processFrameQueue();
          }
        }
      }
    });
  }

  /**
   * Get the current timestamp context (for operation frames).
   * Uses most recent bucket's timestamp, or lastPlayedTimestamp if no buckets.
   */
  private getCurrentTimestamp(): number {
    if (this.frameQueue.length > 0) {
      const lastBucket = this.frameQueue[this.frameQueue.length - 1];
      return lastBucket.timestamp;
    }
    return this.lastPlayedTimestamp;
  }

  /**
   * Ensure a bucket exists for queuing frames.
   * Creates one with the given timestamp if needed.
   */
  private ensureBucketForFrame(timestamp: number): void {
    if (this.frameQueue.length === 0) {
      this.frameQueue.push({ frames: [], timestamp });
    }
  }

  /**
   * Get current elapsed time in playback timeline (non-live mode).
   */
  private getCurrentElapsedTime(): number {
    const now = Date.now();
    const elapsed = now - this.playbackEpoch;
    return Math.floor(elapsed / this.playbackSpeed);
  }

  /**
   * Process all queued buckets sequentially (live mode).
   * Processes frames one at a time from all buckets.
   */
  private async processQueuedBuckets(): Promise<void> {
    // Prevent concurrent execution
    if (this.isProcessingQueuedBuckets) {
      return;
    }
    
    this.isProcessingQueuedBuckets = true;
    
    try {
      // Wait for any pending operation
      if (this.pendingOperation) {
        await this.pendingOperation;
      }

      // Process all buckets sequentially
      while (this.frameQueue.length > 0) {
        const bucket = this.frameQueue.shift();
        if (bucket && bucket.frames.length > 0) {
          // Process each frame in the bucket one at a time
          for (const frame of bucket.frames) {
            // Wait for any pending operation before processing this frame
            if (this.pendingOperation) {
              await this.pendingOperation;
            }
            
            // Process this frame and wait for it to complete
            await this.processFrameAsync(frame, bucket.timestamp);
          }
        }
      }
    } finally {
      this.isProcessingQueuedBuckets = false;
    }
  }

  /**
   * Process a frame asynchronously, returning a promise that resolves when complete.
   */
  private async processFrameAsync(frame: Frame, timestamp: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const previousOperation = this.pendingOperation;
      const operationPromise = previousOperation
        ? previousOperation.then(() => this.playbackHandler(frame, timestamp))
        : Promise.resolve().then(() => this.playbackHandler(frame, timestamp));
      
      const voidPromise = operationPromise.then(() => undefined, (err) => {
        console.error(`[PlaybackQueue] Error handling frame:`, err);
        reject(err);
        return undefined;
      });
      this.pendingOperation = voidPromise;
      
      voidPromise.finally(() => {
        if (this.pendingOperation === voidPromise) {
          this.pendingOperation = null;
        }
        resolve();
      });
    });
  }

  public stop() {
    this.clearTimeout();
  }

  private clearTimeout() {
    if (this.nextEventTimeout) {
      clearTimeout(this.nextEventTimeout);
      this.nextEventTimeout = null;
    }
  }

  private setNextEventTimeout() {
    this.clearTimeout();

    if (this.frameQueue.length > 0) {
      const headBucket = this.frameQueue[0];
      const nextEventTimestamp = headBucket.timestamp;
      const now = Date.now();
      const elapsed = now - this.playbackEpoch;
      const currentTimestamp = Math.floor(elapsed / this.playbackSpeed);
      const timeout = Math.max(nextEventTimestamp - currentTimestamp, 0);

      if (timeout > 0) {  
        this.nextEventTimeout = setTimeout(() => {
          void this.processFrameQueue();
        }, timeout) as unknown as number;
      } else if (!this.isProcessingQueue) {
        // Only call processFrameQueue immediately if we're not already processing
        // (this can happen when enqueueFrame calls setNextEventTimeout)
        void this.processFrameQueue();
      }
    }
  }

  private async processFrameQueue(): Promise<void> {
    // Prevent concurrent processing of the queue
    if (this.isProcessingQueue) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    try {
      // Wait for any pending operation before starting
      if (this.pendingOperation) {
        await this.pendingOperation;
      }

      // Process all ready frames in a loop
      while (true) {
        const now = Date.now();
        const elapsed = now - this.playbackEpoch;
        const currentTimestamp = Math.floor(elapsed / this.playbackSpeed);

        // Process all ready frames
        let processedAny = false;
        while (this.frameQueue.length > 0 && this.frameQueue[0].timestamp <= currentTimestamp) {
          const bucket = this.frameQueue.shift();
          if (bucket) {
            await this.processFrameBucket(bucket);
            processedAny = true;
          }
        }

        // If we processed frames, check again for more ready frames (they may have become ready during processing)
        // Otherwise, check if there are ready frames now (timestamp may have advanced during processing)
        if (!processedAny) {
          // Recalculate timestamp - it may have advanced during processing
          const nowAfterProcessing = Date.now();
          const elapsedAfterProcessing = nowAfterProcessing - this.playbackEpoch;
          const currentTimestampAfterProcessing = Math.floor(elapsedAfterProcessing / this.playbackSpeed);
          
          // Check if any frames are now ready
          if (this.frameQueue.length > 0 && this.frameQueue[0].timestamp <= currentTimestampAfterProcessing) {
            processedAny = true;
            continue;
          }
          
          this.setNextEventTimeout();
          
          // After setting timeout, check one more time if frames became ready
          // (setNextEventTimeout might have detected ready frames but couldn't process them)
          if (this.frameQueue.length > 0) {
            const finalNow = Date.now();
            const finalElapsed = finalNow - this.playbackEpoch;
            const finalTimestamp = Math.floor(finalElapsed / this.playbackSpeed);
            if (this.frameQueue[0].timestamp <= finalTimestamp) {
              continue;
            }
          }
          
          break;
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Process a bucket of frames in non-live mode.
   * Processes frames one at a time sequentially.
   */
  private async processFrameBucket(bucket: PlaybackTimeBucket): Promise<void> {
    this.lastPlayedTimestamp = bucket.timestamp;
    
    // Process each frame in the bucket one at a time
    for (const frame of bucket.frames) {
      await this.processFrameAsync(frame, bucket.timestamp);
    }
  }
}