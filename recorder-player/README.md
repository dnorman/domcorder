# Recorder / Player
This directory contains the recorder and player for web page recording and playback.


## Features

* **Periodic Incremental DOM Diff**: The code will periodically diff the DOM against a prior snapshot and compute the minimal set of mutations to get from the most recent recorded state to the current state.
* **Shadow Root Introspection**: The recorder will have access to all Shadow Roots, even closed ones.
* **StyleSheet Tracking**: The recorder tracks changes to StyleSheets including Constructed StyleSheets.


## TODOs

  - [ ] Allow for onDemand KeyFrames after the initial keyframe.
  - [ ] Integrate StyleSheet Change Detector into the recorder.
  - [ ] Design StyleSheet Change frames.
  - [ ] Add interaction recording such as viewport size, scrolling, focus, etc.
  - [ ] Consider contextually / automatically adjusting diff interval based on user interactions (e.g. more frequent diffs during typing) .
  - [ ] Emit binary frames from recorder instead of current JSON objects.
  - [ ] Consider how the recorder acts when page navigation (think SPA) happens, to include potentially sending a new keyframe rather than a series of deltas.
  - [ ] Reduce translation between internal API objects of the various components.
  - [ ] Consider how we might reduce sending assets we have already sent within the lifetime of the Recorder.
  - [ ] Consider how we might reduce sending assets we have already to the server at some point before (requires server to inform recorder of what is cached relative to the page the recorder is on).
  - [ ] Consider some sort of "navigation" frame where the recorder can inform the server that it is where and what "page" it is on to facilitate asset caching.
  - [ ] Start using / sending Timestamp Frames.


## Installation

```bash
bun install
```

## Demo
```
bun run dev
```

Then visit: http://localhost:3000/recorder-player/

