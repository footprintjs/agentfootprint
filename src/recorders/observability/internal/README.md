**Support** — small stateful helpers imported by `RunStepRecorder` and nothing
else.

## What it reads / what it writes
- Reads the events the recorder hands them.
- Writes only their own per-run bookkeeping. Not part of the public API.

## The one law here
Internal means internal: each file says so in its first line, and nothing
outside `RunStepRecorder` may import it.

## Files
- `ActorArrowClassifier.ts`, `CandidateAnswerBuffer.ts`, `ForkTracker.ts`,
  `RootInferrer.ts`, `SequenceSiblingTracker.ts`.
