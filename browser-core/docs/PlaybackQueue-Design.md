# PlaybackQueue Design Document

## Overview

The `PlaybackQueue` class manages the timing and sequential execution of playback operations for recorded web sessions. It ensures that all operations execute strictly in order, with different timing behaviors for "live" vs "recorded" playback modes.

## Core Requirements

### 1. Sequential Execution (Always)
- **Requirement**: Operations MUST execute strictly in order, one at a time
- **Rationale**: DOM mutations, stylesheet changes, and other operations must be applied in the exact sequence they occurred during recording
- **Constraint**: A subsequent operation must NOT start until the previous operation has fully completed (promise resolved)

### 2. Live Mode
- **Goal**: Playback operations as quickly as possible while maintaining order
- **Behavior**:
  - When a frame arrives and no operation is pending: process immediately
  - When a frame arrives and an operation is pending: queue the frame in appropriate bucket
  - When current operation completes: automatically process the next queued frame immediately
  - **Timestamps**: 
    - Timestamp frames create/update buckets (just like non-live mode)
    - Operation frames are queued into the most recent bucket
    - Timestamps are NOT used for scheduling (all buckets processed ASAP)
    - Timestamps ARE passed to playbackHandler for each frame (recording-side context)
  - Use bucket structure to preserve timestamp context for queued frames

### 3. Non-Live Mode (Recorded Playback)
- **Goal**: Playback operations at approximately the same relative pace as they were recorded
- **Behavior**:
  - Track playback epoch and calculate elapsed time since playback started
  - Compare frame timestamps to elapsed time to determine if it's time to play
  - If frame timestamp <= current elapsed time AND no operation pending: process immediately
  - If frame timestamp <= current elapsed time BUT operation pending: queue the frame
  - If frame timestamp > current elapsed time: queue in appropriate time bucket, schedule timeout
  - **Late frames**: If a frame arrives with a timestamp significantly in the past, process it immediately (don't skip)
  - Respect time buckets: group frames by their target playback timestamp

## State Management

### Key State Variables

```typescript
- pendingOperation: Promise<void> | null  // Current in-flight operation
- frameQueue: PlaybackTimeBucket[]        // Queued frames grouped by timestamp
- lastPlayedTimestamp: number             // Last timestamp that was played
- playbackEpoch: number                   // When playback started (Date.now())
- playbackSpeed: number                   // Playback speed multiplier (1 = realtime, non-live only)
- nextEventTimeout: number | null         // Timer for next scheduled batch (non-live only)
```

### Handler Signature Change

**Old**:
```typescript
playbackHandler: (event: PlayEvent) => Promise<void>
where PlayEvent = { timestamp: number; frames: Frame[] }
```

**New**:
```typescript
playbackHandler: (frame: Frame, timestamp: number) => Promise<void>
```

### Time Buckets (Both Modes)

```typescript
type PlaybackTimeBucket = {
  frames: Frame[];        // Frames to play at this timestamp
  timestamp: number;      // Timestamp associated with these frames
                         // In live mode: used for context only
                         // In non-live mode: used for context AND scheduling
}
```

**Bucket Usage:**
- **Live mode**: Preserves timestamp context when frames queue while operation is processing
  - Timestamp frames update `lastPlayedTimestamp` and create/update buckets
  - Operation frames use the most recent bucket's timestamp (or `lastPlayedTimestamp` if no bucket)
  - Example: While operation A processes → receive Timestamp T1 → O1, O2 → Timestamp T2 → O3, O4
    - T1 updates `lastPlayedTimestamp = T1`, creates bucket T1
    - O1, O2 go in bucket T1
    - T2 updates `lastPlayedTimestamp = T2`, creates bucket T2  
    - O3, O4 go in bucket T2
    - When A completes, process buckets T1 then T2 sequentially with correct timestamps
  
- **Non-live mode**: Groups frames by playback time for scheduling
  - Timestamp frames create buckets for future scheduling
  - Operation frames queue into appropriate bucket based on their timestamp (or most recent bucket)

## Operational Flow

### Live Mode Flow

1. **Frame arrives** → `enqueueFrame(frame)`
   - If `frame instanceof Timestamp`:
     - Update `lastPlayedTimestamp` to the timestamp value
     - Create new bucket with that timestamp (if no bucket exists) OR append to existing bucket
   - Else (operation frame):
     - Determine timestamp: use most recent bucket's timestamp, or `lastPlayedTimestamp` if no buckets
     - If `pendingOperation === null`:
       - Process frame immediately with the determined timestamp
     - Else:
       - Ensure a bucket exists (create one with `lastPlayedTimestamp` if needed)
       - Add frame to most recent bucket (preserving timestamp context)

2. **Frame processing** (`processFrame`):
   - Chain to `pendingOperation` if it exists
   - Set `pendingOperation` to new operation promise
   - Execute operation with frame's timestamp
   - When complete: clear `pendingOperation`, check for queued frames
   - If queued frames exist: process next bucket/frame immediately

3. **Bucket processing** (when operation completes):
   - Process all queued buckets sequentially (one frame at a time)
   - Each frame uses its bucket's timestamp when calling playbackHandler
   - Continue until queue is empty

### Non-Live Mode Flow

1. **Frame arrives** → `enqueueFrame(frame)`
   - If `frame instanceof Timestamp`:
     - Create new time bucket with that timestamp
     - Schedule processing if needed
   - Else:
     - Calculate: `currentElapsed = (Date.now() - playbackEpoch) / playbackSpeed`
     - If `frame.timestamp <= currentElapsed` AND `pendingOperation === null`:
       - Process immediately
     - Else if `frame.timestamp <= currentElapsed` BUT `pendingOperation !== null`:
       - Add to appropriate bucket (current or new "ready" bucket)
     - Else (`frame.timestamp > currentElapsed`):
       - Add to appropriate time bucket (existing or create new)
       - Schedule timeout if needed

2. **Scheduled processing** (`processFrameQueue`):
   - Wait for `pendingOperation` if it exists
   - Process all buckets where `bucket.timestamp <= currentElapsed`
   - Process each bucket sequentially (one at a time)
   - After each bucket: check for more ready buckets, schedule next timeout

3. **Bucket processing** (`processFrameBucket`):
   - Wait for `pendingOperation` before starting
   - Process each frame in bucket sequentially (one at a time)
   - For each frame: wait for previous frame's operation to complete before starting next
   - Set `pendingOperation` for each frame operation
   - Clear `pendingOperation` when bucket complete

## Processing Model: One-at-a-Time

### Decision: Switch to One-at-a-Time Processing

- **Change**: Process frames one at a time instead of batching
- **Rationale**: Simplifies sequencing logic, makes async operations easier to reason about, removes burden from PagePlayer to handle batch processing correctly
- **Implementation**: Each frame gets its own `playbackHandler` call with a single frame
- **Handler Signature**: `playbackHandler(frame: Frame, timestamp: number): Promise<void>`

## Key Design Decisions

### 1. Promise Chaining
- Operations chain to `pendingOperation` to ensure sequential execution
- Set `pendingOperation` synchronously before async work starts (prevents race conditions)
- Clear `pendingOperation` only when operation fully completes

### 2. Live Mode Queueing
- Even in live mode, frames must be queued if previous operation is pending
- Use bucket structure to preserve timestamp context
- Timestamp frames create/update buckets
- Operation frames queue into most recent bucket
- Auto-process queued buckets immediately when current operation completes
- Timestamps are used for context (passed to handler), not scheduling (all play ASAP)

### 3. Timestamp Handling
- **Live mode**: 
  - Timestamps create/update buckets to preserve context
  - Operations queue into most recent bucket
  - Buckets preserve timestamp associations for handler
  - Timestamps NOT used for scheduling (all buckets play ASAP)
  - Timestamps ARE passed to handler for recording context
- **Non-live mode**: 
  - Timestamps create/update buckets for context AND scheduling
  - Operations queue into appropriate bucket by timestamp
  - Buckets scheduled based on timestamp relative to playback epoch
  - Timestamps passed to handler for recording context

### 4. Race Condition Prevention
- Check `pendingOperation` and `frameQueue.length` atomically
- Set `pendingOperation` synchronously before any async operations
- Use promise chaining rather than await loops

## Edge Cases

1. **Rapid frame arrival**: Multiple frames arrive synchronously before any async work starts
   - Solution: First frame processes immediately, subsequent frames queue, all chain correctly

2. **Long-running operations**: Operation takes longer than expected
   - Solution: Subsequent frames queue until current completes, then process in order

3. **Mixed live/non-live transitions**: Not applicable (mode set at construction)

4. **Timestamp frames arriving late**: Timestamp frame arrives after regular frames
   - Solution: Create new bucket, frames after timestamp go to new bucket

5. **Empty buckets**: Bucket with no frames (just timestamp)
   - Solution: Still process to update `lastPlayedTimestamp`, schedule next timeout

## Implementation Strategy

### Phase 1: Sequential Processing Foundation
- Implement promise-based sequential processing for both modes
- Ensure `pendingOperation` correctly tracks in-flight operations
- Fix race conditions with atomic check-and-set

### Phase 2: Live Mode Simplification
- Simplify live mode to use single "current" bucket
- Auto-process queued frames when operation completes
- Remove timestamp-based scheduling for live mode

### Phase 3: Non-Live Mode Timing
- Ensure proper timestamp-based scheduling
- Handle time bucket creation and processing
- Schedule timeouts correctly

### Phase 4: Testing
- Comprehensive unit tests for all scenarios
- Test rapid frame arrival
- Test long-running operations
- Test mixed immediate/queued frames
- Test timestamp edge cases

## Design Decisions Made

1. **Frame Processing Model**: ✅ Switch to one-at-a-time
   - Each frame processed individually via `playbackHandler(frame, timestamp)`
   - Simpler sequencing logic, easier async handling

2. **Timestamp Frames in Live Mode**: ✅ Track timestamps but ignore for timing
   - Timestamps still passed to playbackHandler (for recording-side context)
   - All frames processed immediately regardless of timestamp

3. **Playback Speed**: Only applies to non-live mode
   - Live mode processes as fast as possible

4. **Operation Completion Definition**: When promise resolves
   - PlaybackQueue's responsibility ends when promise resolves
   - PagePlayer and delegates determine when operation is "complete" (e.g., DOM effects visible)

5. **Late Frames in Non-Live Mode**: Process immediately
   - Don't skip late frames, just play them right away

6. **Live Mode Bucket Structure**: Use buckets to preserve timestamp context
   - Timestamp frames create/update buckets (same as non-live mode)
   - Operation frames queue into most recent bucket
   - Buckets preserve timestamp context for frames queued while another operation is processing
   - Example: If operation A is processing, and we receive Timestamp T1 → O1, O2 → Timestamp T2 → O3, O4,
     then O1,O2 go in bucket T1, O3,O4 go in bucket T2, and when A completes, we process both buckets
     with correct timestamps

## Testing Requirements

1. Sequential execution verification
2. Live mode immediate processing
3. Live mode queueing when busy
4. Non-live mode timestamp-based scheduling
5. Mixed immediate/queued operations
6. Rapid frame arrival scenarios
7. Long-running operation scenarios
8. Timestamp frame edge cases

