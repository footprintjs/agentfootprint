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
of this turn (a pause between legs of one turn keeps it current; an earlier turn is `stale-turn`),
have run and returned, carry a local composed row, and fit the kind (`none` a declared absence that
is not an `among` miss and has no next page; `not-found` an `among` miss; `complete` a complete
search with no cap reached, no next page, nothing `partial`). A gap never withholds — the statement
says it. The monotone withholds read the call sequence: rows on the same or a narrower search;
rows on a wider search not provably outside the cited filters; for `complete`, a same-search read
with more rows or a row provably inside its scope that its list lacks; a same-search failure after
the read; any dispatched call the caller does not classify as a read, after it or in its batch. A
field holds at most 32 claims and a claim cites at most 16 reads (`too-many-claims` beyond).

**The statement** (`statement.ts`). The library's own voice states only what the record shows
("no cap reached"); everything else is quoted and attributed — "(declared by the tool)", "(fixed
by the tool)", "(the tool's declared default)", "(as sent by the model)", "(as the tool's result
says)". Every gap is listed; an unsent argument is worded with care ("was not sent, so the tool may
have applied its own default and this may cover only part").

**The prose notes** (`containment.ts`). Resolve by the entity each call was SENT for (or a
population-less search's `source.said` words); then note what a citation would have made exact:
`scope-wider`, `coverage-gap`, `subject-unmatched`, `rows-undecided`, `period-*`, `cap-reached`,
`paged`, `partial` and the rest. A hedge is not scope. A search with no note leaves the claim with
no note; the others then note only what they BEAR on it. Nothing here throws on model text
(`test/integrity/negative-claim/fuzz.test.ts`).

**Same search** (`readings.ts`) means the same COMPOSED executed scope — filters in effect,
defaults as if sent, fixed qualifiers, host-filled identities by reference, a relative window by
its spelling within the turn, the page — never the model-visible arguments alone. Whether a call
READ is the caller's to say (`TurnCall.effect`; undeclared = not a read).

**One owner each.** The rows are #199's `ComposedCoverage` (`semantics/coverage/composedCoverage.ts`)
and the declarations its `ToolSearch`. Words are spelled by the library's one spelling leaf
(`lib/normalize.ts`: `foldCase` for the grammar's words, `sameName` for names and values);
`matcher.ts` owns only the tokens' offsets and the phrase matcher. Time is the time layer's
half-open ranges and #199's `span.ts`: a read's window is the span it ran with at dispatch.
A claim may cite a read by its result identity or by the handle the library serves (`r3`).

**Not wired.** Nothing in the agent calls this folder yet: PR 4 mounts the typed door, PR 5 the
prose door. The free replay over recorded replies is `bench/negative/`.

**Example.**

```ts
import { judgeTypedNegatives } from './judge.js';

const [judged] = judgeTypedNegatives({
  field: 'negatives',
  negatives: [{ kind: 'none', restsOn: ['claim-result/ns/run-7/3'] }],
  record, // the turn's calls, rows, declarations and clock
});
// judged.row        → { code: 'established', disposition: 'not-applicable', results: [...] }
// judged.statement  → "`list_incidents` found none — subject `incidents` (declared by the
//                      tool); `service` `payments` (as sent by the model); … not checked:
//                      `incidents filed by email` (declared by the tool)."
```
