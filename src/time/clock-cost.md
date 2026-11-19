# Clock dispatch cost

The [dispatch test](../../test/time/clock-run.test.ts) measures 43 ledger row visits per call at 20
calls and 403 at 200, averaged over each run. `stages/timeLayer.ts` looks up the window before and
after filing the call and looks up the clock, using backward scans owned by `time/rows.ts`.
`findings/ledger.ts` spreads the existing rows on each append. The known cost grows linearly with
the existing rows per call. A follow-up card tracks making it constant.
