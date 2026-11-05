---
type: changed
bump: minor
---
**Integrity findings now reach the answer's standing, so some answers that read "consistent" now read "not sure".** Only with `.answerLayer()` armed. Until now a check could file a problem and the standing never heard of it, because the fold reads committed rows and those findings were events.

These now lower the standing to "not sure", each with its own reason and witness: `unsupported-claim`, `unsupported-argument`, `invariant-violation` (at the write that served the tools and on the wire), `column-type-mismatch` and `missing-column`. A `.claims()` field the answer states and no tool settled also reads "not sure", with the new reason `claim-unsettled`; a field that agrees is unchanged.

These stay notes and do not move the standing: `dangling-reference`, `empty-lookup` and `prior-turn-evidence`. They appear on the new `AnswerAssessment.notes`, read through `agent.assessment()` or `assessAnswer(recording)`.

What to do: if you branch on `standing === 'consistent'`, expect fewer of them, and read `reasons` to see what was found; each witness points at the row. If you have a table of reason kinds, add the six new ones (a reader that skips unknown kinds keeps working). Under `.answerLayer({ standingLine })` the line can name them, and the line's version is now 4. Nothing changes without `.answerLayer()`: no row, no key, and the same events.

Also fixed: on `reactMode: 'dynamic-grouped'`, a second distinct integrity finding in a later pass failed the run with `Cannot write to readonly input key "integrityFindingIds"`. An observe-only check no longer stops a run. On that chart shape, the seen-list now enters the LLM-call subflow under the alias `priorIntegrityFindingIds`, so a recording of a run that filed a finding shows that key.
