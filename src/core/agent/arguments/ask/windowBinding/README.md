# Walker — window answer binding

The `../windowBinding.ts` facade preserves the existing functions and result types. This sealed library separates four existing responsibilities; only the facade and this folder import its implementation. Every function remains a plain function over the supplied field, tools and saved clock, with no executor, scope, pause or model.

| Unit            | One job                                                                        | Internal runtime dependencies |
| --------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| `answer.ts`     | bind a zone or range answer and retain confirmation-only member handling       | editedZone, fills, question   |
| `editedZone.ts` | select the offered, fixed-offset or app display zone from both typed endpoints | none                          |
| `fills.ts`      | convert the answered window into each call's declared form and validate values | none                          |
| `question.ts`   | project and narrow the next existing time question                             | none                          |
| `types.ts`      | shared binding and per-call fill result shapes                                 | none                          |

Parent helpers remain behind their existing owners: `../fields.ts` owns readability/narrowing, `../validation.ts` owns property lookup and `../constants.ts` owns expectations. No helper imports the window-binding facade at runtime. `editedZone` and `windowFills` gain internal exports only; no facade or package export is added.

This is whole-unit structural work: current bodies, literals, order and decisions are retained. The **earlier question behavior change is retained**, rather than described as a move: the shared `windowQuestion` accepts either a zone or range follow-up, removes stale choice/label/zone/reading data before projecting a new question, and carries a corrected reading only on a declared reply association. Its native-zone caller and correction caller continue using that same projection. The split neither introduces nor reverts that behavior.

Existing coverage remains through the ask facade and the native time/correction tests. This extraction claims no test result or source approval. Root executes identity/format/hosted checks; behavior changes and additional regressions belong in a separate visible delta.
