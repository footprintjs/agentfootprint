**Support** — The existing S3 streamed-payload length walk.

## The one law here

Read and yield the original chunks, cancel on excess length, always release the reader lock, and refuse a short stream with the original adapter-specific error sentence.

## Files

- `countedChunks.ts` — The existing S3 streamed-payload length walk.
