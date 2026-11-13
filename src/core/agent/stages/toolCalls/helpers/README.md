**Mixed** — the existing tool-call sentence composers and small utilities.
Lens: `dispatchRefusals.ts` and `readSkillRefusal.ts` compose model-facing refusals.
Walker: `mountedCursor.ts` answers the current cursor's stay/admission question.
Support: `dedupeIds.ts` and `periodWarnings.ts` retain ID and warning utilities;
`sourceNote.ts` holds `SOURCES_NOTE`, the one frozen note option handed to a call
whose served schema carries `_findings.from`; `unscopedRun.ts` holds `UNSCOPED_RUN`,
the shared ledger key for a dispatch loop built with no run accessor (a test,
never an Agent).

Both warning sets, both warning functions and their reset live together in
`periodWarnings.ts`, once per module instance. The old stage path re-exports
its existing composers and reset; callers do not need the internal paths.
