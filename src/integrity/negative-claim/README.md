**Mixed** — one check over the recorded searches, and the sentence a person reads.
Fold: `citation.ts` · `judgeCitation` (a typed claim against the reads it cites) and
`containment.ts` · `entityNotes` (a prose claim against the reads it names) — what may be said
about "none", "not found" and "the list is complete", from committed rows only.
Lens: `statement.ts` · `composeStatement` — the library's own sentence for an established typed
claim, every row text quoted as the tool's words.

# negative-claim — "there are none", checked against what was searched

**Why.** A model turns "the tool found nothing" into "it does not exist": "payments has no
incidents", "that is the full list", "the array is not in your estate". The record knows what
each search was made of — its source, subject, qualifiers, window, gaps — once a tool declares
`search` (design `docs/design/2026-10-negative-claims.md`, § 3). This checker holds a negative
claim to that record, by code: no model, no clock, no I/O.

**Two doors.**

| Door | The claim | What it can do |
| --- | --- | --- |
| typed (`judge.ts` · `judgeTypedNegatives`) | `{ kind: 'none' \| 'not-found' \| 'complete', restsOn: [resultId, …], about? }` — a CITATION of the library-minted result identities (`claim-result/<ns>/<runId>/<ordinal>`), never a provider call id | one row per claim; established ⇒ `not-applicable` and the library's statement; anything else withholds (`checked-fail` or `unreachable`) |
| prose (`prose.ts` · `judgeProseNegatives`) | a sentence the fixed grammar finds (`detect.ts`, `phrases.ts`) | NOTES only — observe, never withhold |

**The typed rules** (`citation.ts`). Only the cited read itself can establish a claim: it must be
of this run leg and turn, have run and returned, carry a local composed row, and fit the kind
(`none` a declared absence that is not an `among` miss; `not-found` an `among` miss; `complete`
a complete search with no cap reached, no next page, nothing `partial`). A gap never withholds —
the statement says it. Four monotone withholds read the call sequence: rows on the same or a
narrower search; rows on a wider search not provably outside the cited filters; a same-search
failure after the read; any dispatched call that is not a read after it (or in its batch).

**The prose notes** (`containment.ts`). Resolve by the entity each call was SENT for (or a
population-less search's `source.said` words); then note what a citation would have made exact:
`scope-wider`, `coverage-gap`, `subject-unmatched`, `rows-undecided`, `period-*`, `cap-reached`,
`paged`, `partial` and the rest. A hedge is not scope. A search with no note establishes the
claim; the others then note only what they BEAR on it.

**Same search** (`readings.ts`) means the same COMPOSED executed scope — filters in effect,
defaults as if sent, fixed qualifiers, host-filled identities by reference, the window resolved
on the leg's clock, the page — never the model-visible arguments alone.

**PR 2's shapes are stand-ins.** `searchRow.ts` holds local copies of `Tool.search` and the
composed row, field for field with the design note; PR 2's exported types replace that one file.

**Not wired.** Nothing in the agent calls this folder yet: PR 4 mounts the typed door, PR 5 the
prose door. The free replay over recorded replies is `bench/negative/`.

**Example.**

```ts
import { judgeTypedNegatives } from './judge.js';

const [judged] = judgeTypedNegatives({
  field: 'negatives',
  negatives: [{ kind: 'none', restsOn: ['claim-result/ns/run-7/3'] }],
  record, // this leg's calls, rows, declarations and clock
});
// judged.row        → { code: 'established', disposition: 'not-applicable', results: [...] }
// judged.statement  → "`list_incidents` found none — as the tool names them: subject
//                      `incidents`; for `service: payments`; … not checked: `incidents filed
//                      by email`."
```
