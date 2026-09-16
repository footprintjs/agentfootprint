# The findings ledger — facts, open questions and noise, kept apart (2026-09-16)

Status: DESIGN. Tracked here; facts found while building change this page.
Not started until the owner says go on the cut below.

## The problem, in the owner's words

A person working a task tries a tool, reads what came back, decides it is a
fact, a lead worth another tool, or noise, and moves on. After ten or
twenty of those the pile in front of them is large and the distinction is
in their head. When they sit down to answer, the first two facts are
clear, the rest is a blur, and a guess from step six reads exactly like a
fact from step two. Our agent loop has the same pile: every tool result
enters the served messages with equal standing, and the model must
remember, from its own earlier turns, which ones mattered. Findings get
lost incrementally, and hypothesis data and fact data tangle at the answer.

## What exists (read before designing)

- **Every tool result is on the record.** `scope.toolResults` holds one
  entry per dispatched call; the served messages carry each result as a
  `role: 'tool'` message; datasets can be minted as artifacts and handed
  to the model as references with their meaning.
- **Claims are judged at the end.** The Route decider keeps an integrity
  ledger, files a finding when the answer's claims disagree with the run's
  settled facts, and the `evidence-recheck` branch loops once to fetch
  what an answer needs. The catch is late: the answer is already drafted.
- **The vocabulary of a finding exists — in ContextFootprint.** Its
  `Assertion` is `{ subject: { kind, id }, predicate, value, epoch,
  stratum, provenance }`, and `conflictsOf(assertions)` returns the groups
  of incompatible current readings. It collects nothing and decides
  nothing; the host supplies the assertions. That is the exact shape of a
  ledger entry and the exact algebra of "not sure": two readings of the
  same subject and predicate that disagree.
- **The served-context vocabulary exists — in the context contract.**
  `facts` (with source and scope), `limitations`, `evidenceRefs` (need
  resolution), `nextSteps` (proposals). Those are the owner's three buckets:
  sure, not sure, still needed.
- **Eviction is by budget, not by standing.** When the context fills, turns
  are evicted by size; a noise result can outlive a fact.

## The design

**One ledger, kept in the run's state, written as the loop runs.**

- After each tool return, the model is asked for the findings that result
  supports — each an assertion in ContextFootprint's shape, with
  `provenance` = the tool result's identity on the record (its entry in
  `scope.toolResults`, and the artifact ref when the result was minted) —
  and one disposition for the result:
  - `fact`: the result supports at least one assertion the model stands on;
  - `open`: the result suggests an assertion but does not settle it, and
    names what would;
  - `noise`: the result supports nothing for this task (kept as one line:
    tried, returned nothing useful).
  The disposition is the model's claim, recorded as such. The library never
  infers one.
- `conflictsOf` runs over the ledger's current assertions on every write.
  A conflict is a fact about the run, not an error: it goes in the "not
  sure" bucket with both witnesses, in their order.
- **The answer turn is served the ledger, not the pile:** facts with their
  refs, conflicts with their witnesses, open assertions with what would
  settle them, noise collapsed to its one-line count. The raw results stay
  on the record as artifacts, redeemable by ref — nothing is deleted, only
  not served. This is the context contract's `facts` / `limitations` /
  `evidenceRefs` / `nextSteps` filled from the ledger instead of by hand.
- **Eviction becomes standing-aware:** noise first, open next, facts last.
- **The Route decider's integrity ledger reads the same assertions**, so a
  claim in the answer that contradicts a ledger fact is caught with the
  same machinery as today, earlier.
- **The Lens shows the ledger at every stop:** an assertion entering,
  changing disposition, joining a conflict — the Context view's since-marks
  over the ledger key, and a "Findings" band on the Why Lens.

## Where each piece lives

| Piece | Home | Why there |
|---|---|---|
| Assertion shape, `conflictsOf` | ContextFootprint (exists) | the pure algebra, no runtime |
| The ledger state key, the stage that asks for findings, the disposition record, eviction order | agentfootprint | the loop and the record are here |
| The served form at the answer turn (ledger → contract fields) | agentfootprint, on the context contract's fields | the contract already names the buckets |
| The Findings band, since-marks over the ledger | agentfootprint-lens | the reader |

## Laws

- A finding is the model's claim with a recorded provenance; a disposition is
  the model's claim; a conflict is the algebra's fact. None is inferred by
  the library.
- Served, never deleted: the pile stays on the record; the ledger is what
  the model sees at the answer.
- The bench decides. Before this ships, a checked-in bench: runs of ten to
  thirty tool calls with planted facts and planted noise, measuring how
  many planted facts reach the answer, and how many noise items are cited,
  with and without the ledger. No number is quoted before it exists.

## The cut (one at a time, each shippable)

1. **The bench and the fixture runs** — planted facts and noise on the mock
   provider; the measurement harness; today's numbers as the baseline.
2. **The ledger on the record** — the state key, the findings request after
   each tool return, dispositions, `conflictsOf` on write (ContextFootprint
   as a dependency); the Lens shows the key like any other. No change to
   what is served yet. Measured: nothing should move.
3. **Served from the ledger** — the answer turn's context built from the
   ledger through the contract's fields; noise collapsed. Measured against
   the baseline: this is the packet that must move the number.
4. **Standing-aware eviction.** Measured on long runs.
5. **The Findings band in the Why Lens.**

## Open questions for the owner

- Who authors the disposition when a tool result is a dataset reference
  rather than text: the model reads the reference's meaning, not the rows,
  so "fact" there means "this reference is the one I stand on". Fine, but
  it should be said.
- ContextFootprint is in the other agent's line. Making agentfootprint
  depend on it is a decision for both lines.

## Track

- [x] design · [x] 1 bench + baseline (`npm run bench:findings`, `bench/findings-context.mjs`) · [ ] 2 ledger on the record · [ ] 3 served from the ledger · [ ] 4 eviction · [ ] 5 Findings band

## Baseline (2026-09-16, `bench/findings-context.mjs`, mock provider, 20 tool calls, a planted fact every 3rd)

| window | planted facts | facts present at the answer turn | noise results present | noise share of tool-result bytes | tool messages served | messages served (receipt) |
|---|---|---|---|---|---|---|
| none | 6 | 6 | 14 | 93.5% | 20 | 41 |
| sliding, keep 6 turns | 6 | 2 | 4 | 92.3% | 6 | 13 |

Read: without a window nothing is lost but the answer turn is served a pile
that is nine-tenths noise; with today's eviction, by recency, four of six
facts are gone before the model answers. Neither serves the facts and only
the facts. Step 3 must move both columns: facts present back to 6, noise
share toward the one-line count.

FACT for the bench's own shape: the bench is plain JavaScript on node,
importing the package's built doors by self-reference — under tsx's ES
module loader, footprintjs's `./trace` export resolved to its types file
(a packaging note for footprintjs: the `exports` condition order).
