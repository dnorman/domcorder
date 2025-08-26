import { Frame, Timestamp } from "@domcorder/proto-ts";

export type PlaybackTimeBucket  = {
  frames: Frame[];
  timestamp: number;
};

export type PlayEvent = {
  timestamp: number;
  frames: Frame[];
}

export class PlaybackQueue {
  private lastPlayedTimestamp: number;
  private readonly frameQueue: PlaybackTimeBucket[];
  private readonly playbackEpoch: number;

  private nextEventTimeout: number | null;

  private playbackSpeed: number;
  private readonly playbackHandler: (event: PlayEvent) => void;
  live: any;

  constructor(live: boolean,playbackHandler: (event: PlayEvent) => void) {
    this.lastPlayedTimestamp = 0;
    this.frameQueue = [];
    this.playbackEpoch = Date.now();
    this.nextEventTimeout = null;
    this.playbackSpeed = 1;
    this.playbackHandler = playbackHandler;
    this.live = live;
  }

  public enqueueFrame(frame: Frame) {
    if (this.live) { 
      if (!(frame instanceof Timestamp)) {
        this.playbackHandler({
          timestamp: this.lastPlayedTimestamp,
          frames: [frame],
        });
      }
    } else if (this.frameQueue.length === 0) {
      if (frame instanceof Timestamp) {
        // We don't have anything queued, we are going to create a new bucket
        // for the timestamp.  However, since this is the bucket at the head
        // of the queue, we can now calculate the timeout for the next event.
        this.frameQueue.push({ frames: [], timestamp: Number(frame.timestamp) });
        this.setNextEventTimeout();
      } else {
        // We have nothing queued, so we can just play the frame
        // because we are already playing the current time context.
        this.playbackHandler({
          timestamp: this.lastPlayedTimestamp,
          frames: [frame],
        });
      }
    } else {
      if (frame instanceof Timestamp) {
        this.frameQueue.push({ frames: [], timestamp: Number(frame.timestamp) });
      } else {
        const lastBucket = this.frameQueue[this.frameQueue.length - 1];
        lastBucket.frames.push(frame);
      }
    }
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
          this.processFrameQueue();
        }, timeout) as unknown as number;
      } else {
        this.processFrameQueue();
      }
    }
  }

  private processFrameQueue() {
    const now = Date.now();
    const elapsed = now - this.playbackEpoch;
    const currentTimestamp = Math.floor(elapsed / this.playbackSpeed);

    while (this.frameQueue.length > 0 && this.frameQueue[0].timestamp <= currentTimestamp) {
      const bucket = this.frameQueue.shift();
      if (bucket) {
        this.processFrameBucket(bucket);
      }
    }

    this.setNextEventTimeout();
  }

  private processFrameBucket(bucket: PlaybackTimeBucket) {
    this.lastPlayedTimestamp = bucket.timestamp;
    this.playbackHandler({
      timestamp: bucket.timestamp,
      frames: bucket.frames,
    });
  }
}