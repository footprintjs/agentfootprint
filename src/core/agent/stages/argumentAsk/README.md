# Batch time reading

`reading.ts` selects the current turn's one unresolved time mention for the
batch ask. It calls the existing time-window rule, excludes settled mentions
and detaches the selected row. The facade owns all effects and pauses.

The integration behavior is exercised by `test/time/reader-run.test.ts` and
`test/time/viewer-display-continuity.test.ts`.
