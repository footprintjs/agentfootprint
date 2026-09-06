**Support** — the four sinks shipped in core, used when a consumer enables a
feature without supplying one.

## What it reads / what it writes
- Reads the events its interface receives.
- Writes to the console, to a callback, or to an in-process accumulator.

## The one law here
A default must be inert enough to be safe and honest enough to be useful: the
no-op says it is a no-op rather than pretending to deliver.

## Files
- `consoleObservability.ts`, `inMemorySinkCost.ts`,
  `chatBubbleLiveStatus.ts`, `noopLens.ts` (the viewer sink's wildcard
  fallback), `index.ts`.
