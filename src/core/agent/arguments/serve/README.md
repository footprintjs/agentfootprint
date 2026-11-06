# Lens — served argument surfaces

This sealed library owns the inputs layer's served schema, late time line, result notes, refusals and assumed-value view. The `../serve.ts` facade retains every existing public export. Only that facade and this folder import these implementation modules; callers retain the facade import.

| Unit | One job | Internal dependencies |
|---|---|---|
| `values.ts` | quoted primitive values and the rule's assumption sentence | none |
| `schema.ts` | decorate a rebuilt schema with declared ask/assume rules | values |
| `windows.ts` | compose the late settled/control/refused/pending window line | values, clock, refusals |
| `clock.ts` | clock sentence, time limits and the line's one authorship opening | none |
| `fills.ts` | past-tense notes for the values the call actually ran with | values; schema types only |
| `refusals.ts` | past-tense refusal reasons and kept-answer notes | none |
| `assumed.ts` | the one record fold and rendered Assumed block | none |

The extraction moved whole units: Root's static comparison accounts for the original implementation bytes and identical public exports. `refusalReason` gains internal export visibility so the refused-window composer uses the same original function. No helper imports the facade and no new public export is introduced. The facade and every implementation module are below the file-size ceiling; no further split step is left for this file.

The separate behavior change in `windows.ts` serves accepted corrected windows even though they no longer borrow the original quote. It names them as a corrected window, converts their canonical meaning through the same converter as a tool fill, and retains the tool's hidden-argument view. Original quoted-window wording remains unchanged.

Current behavior coverage remains in the existing argument-layer, time, limits, answer-account and model-facing surface tests. Their source inventories name these actual owners while runtime imports continue through the facade. This extraction makes no test result, rendering improvement or source-approval claim; Root executes the exact-head checks.
