**Fold** — one reader per row of the answer account: each reads its own facts
from the run's recording view and writes that row's lines through `say` (the
per-sentence catch). No reader reads another row's lines.

| file | row(s) |
|---|---|
| `common.ts` | the shared context (`say`, the size budgets), pointers, vars, the model's view of a result (`readEmptiness`) |
| `asked.ts` | You asked |
| `understood.ts` | It understood — and check 1, decided-delivered (non-delivery needs a complete record) |
| `calls.ts` | the calls of THIS run: outcome (before-tool refusals only), coverage, emptiness |
| `checked.ts` | It checked / It did not check — and the calls before a pause |
| `inView.ts` | earlier answers' results in front of the model — the witness rule, distance ≥ 1 |
| `found.ts` | It found |
| `howSure.ts` | How sure |

Example — the witness rule on the real recording selects `events[64]` (the
turn-1 `powerstore_get_volumes` result) and never `events[68]` (this run's own
call): `witnessesOf(view, answeringIteration(view))` → `[64, 68]`, and
`readInView` keeps only `[64]` (distance 1).
