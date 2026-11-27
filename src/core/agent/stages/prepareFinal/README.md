**Lens** — the standing line and its saved display evidence for final capture.

# Final standing line

`standing.ts` reads the assessment stage’s line and keeps the accompanying evidence with it through `turn_end`. A filtered turn carries only the omission flag. A named line carries the app’s display names so the saved answer account can recognize what was appended.

The final stage still owns delivered text and the independently composed coverage, assumed values and script blocks. The real-record cases live in `test/core/agent/assessment/standing-line-modes.test.ts`.

`presentation.ts` reads the existing clock and its turn's optional display
declaration for the final answer. It loads the established formatter only under
the time layer. No interpretation or persisted display copy is introduced.
Tests: `test/time/viewer-display-run.test.ts` and
`test/time/viewer-display-continuity.test.ts`.
