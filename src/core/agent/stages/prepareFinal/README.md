**Lens** — the standing line and its saved display evidence for final capture.

# Final standing line

`standing.ts` reads the assessment stage’s line and keeps the accompanying evidence with it through `turn_end`. A filtered turn carries only the omission flag. A named line carries the app’s display names so the saved answer account can recognize what was appended.

The final stage still owns delivered text and the independently composed coverage, assumed values and script blocks. The real-record cases live in `test/core/agent/assessment/standing-line-modes.test.ts`.
