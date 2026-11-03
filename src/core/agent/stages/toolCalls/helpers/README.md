**Mixed** — the existing tool-call sentence composers and small utilities.
Lens: `dispatchRefusals.ts` and `readSkillRefusal.ts` compose model-facing refusals.
Walker: `mountedCursor.ts` answers the current cursor's stay/admission question.
Support: `dedupeIds.ts` and `periodWarnings.ts` retain ID and warning utilities.

Both warning sets, both warning functions and their reset live together in
`periodWarnings.ts`, once per module instance. The old stage path re-exports
its existing composers and reset; callers do not need the internal paths.
