# prior-turn-evidence — grounded, and nothing this turn fetched grounds it

**Why.** A consumer's agent answered a data question with ZERO tool calls, and the evidence gate
approved it:

```
LLM calls 1 · Tool calls 0 · Iterations 1 · Skills active: none
+4802ms  All 7 values in the answer were found in what the tools returned — the answer stands.
```

They were found — in an inventory result from **four turns earlier**, fetched for a different
question. The user had asked about array performance; the answer was assembled from that inventory
and confidently recommended enabling a collector that had been running for months. Two turns did it
back to back. Every rail passed, and passed honestly: the gate measures GROUNDEDNESS and had no
notion of WHEN a value was grounded.

**And the gate said otherwise — the half of this that is a bug, not a feature.** Both of the gate's
user-facing sentences — the correction it sends the model and the warning it prints an operator —
said the flagged values *"appear in NO tool result **from this turn**"*. The index behind them has
never been turn-scoped: it walks every `role: 'tool'` turn in the history. The library was
**asserting a boundary it did not measure**, in the two places that assertion is read. 9.83.0
narrowed the sentences to the check's real reach ("no tool result this run read" — which is also
stronger and true) and made the boundary something the index can actually measure.

**What the library already knew**, held separately:

1. **which values the index could ground** — the gate computes that already, for every armed agent;
2. **which turn each was last served in** — one number, stamped during the walk that was already
   happening. A turn starts at each `role: 'user'` message the library did not author.

When every grounded value's newest source is older than the turn being answered, the answer was
assembled from the conversation rather than from anything this turn went and looked at.

**The ceiling, and why this can never be an accusation.** Referring back is ordinary conversation.
**Nothing here can tell a legitimate reference from a stale one**, and nothing here pretends to. The
ceiling sentence has ONE owner — `PRIOR_TURN_EVIDENCE_CEILING`, exported and quoted verbatim into
every message:

> An answer that legitimately refers back to an earlier result is indistinguishable, by evidence
> alone, from one that has gone stale: this reports WHERE the values came from and never whether
> they were still the ones the reader wanted. It counts only the turns still in the live window, so
> the distance it names is a floor, and values the run supplied rather than fetched (the prompt, a
> fact, a recalled passage) are exempt from grounding and invisible to it. A place to look, never a
> verdict that anything is wrong.

Three bounds, all load-bearing:

- **Indistinguishable.** The identical advisory is filed for the honest follow-up whose tool
  contributed nothing to the answer and for the four-turns-stale one.
- **The live window.** The corpus is `scope.history` as it stands at judgement, and `.window()` /
  `.compaction()` / `tokenBudget` rewrite that in place. So the ordinals count the turns the run can
  still SEE — "turn 2 of 4" may be the conversation's turn 9 of 13 — and the distance is a **floor**.
  The *boundary* is exact regardless: the current request is un-droppable by every window strategy.
- **Exempt values are invisible.** A value that reached the model through `.memory()` recall or RAG
  is exempt from grounding, so it is counted in neither bucket. This check can under-report and can
  never over-report.

**Not `unsupported-claim`, and the names must not blur.** That one means *the answer says something
the record contradicts*. This is the opposite fact: every value **is** in the record, and the only
question is when it got there.

**What keeps an honest follow-up quiet.** ONE grounded value from this turn's own results is enough
to file nothing. That is not a threshold to tune — the claim being tested is that EVERY value came
from earlier, and one that did not falsifies it outright. In practice a follow-up that calls a tool
gets this for free: a lookup keyed on an earlier identifier echoes that identifier back in its own
result, so the value is re-served this turn and re-stamped.

**The corpus is deliberately NOT narrowed.** Restricting the index to this turn would have made the
gate's old sentence true and been the wrong fix: *"and what about that disk?"* leans on the previous
turn's rows legitimately, and a check that cries wolf is a check somebody turns off.

**Where it checks.** The **claim seam** — beside `unsupported-claim`, at the moment the answer is
about to be handed back. It runs on every outcome the gate reaches, clean or flagged, and it never
chooses a branch: the revise / refuse / flag decision is byte-for-byte the one every release since
9.35.0 made.

**The dispositions:**

| State | Disposition |
| --- | --- |
| at least one grounded value came from this turn's own results | `checked-pass` |
| every grounded value is older, and this turn contributed none | `checked-fail` (one advisory) |
| the answer names no value the index could ground | `unreachable` — nothing to attribute |
| the history carries no user turn, so there is no boundary | `unreachable` |
| the evidence index hit its ceiling and is incomplete | `not-applicable` |
| the answer was empty — nothing to attribute | `unreachable` |
| the answer was denied by a message middleware, or rejected by the output schema | `not-applicable` — the gate deliberately does not run there |

The last two rows are not bookkeeping. An **armed row nobody noted** is what
`assertAlive` reads as wiring rot, so under `integrityPosture: 'dev'` an empty
answer would otherwise fail a perfectly healthy run with `CheckerDeadError`.
Every terminal exit that reaches a caller without a grounding reading says so.

**Armed by two halves.** `AgentOptions.noticePriorTurnEvidence: true` **and**
`.namesAndNumbersFromEvidence()`. The second is structural rather than a policy companion: the gate
owns the extractor that decides which tokens in an answer are DATA at all, so a dial without it has
nothing whose provenance it could read. Absent, a run is byte-identical — no finding, no event,
nothing on the wire changes. The one visible difference is the registered `prior-turn-evidence` row
filed `not-applicable`, which is the family's law rather than an exception to it.

**The strong tell is the same finding, not a second kind.** A turn that served no tool results at
all sourced every value from history *by construction* — no index required. That is a cheaper PROOF
of the identical fact, not a different defect, so it rides as its own witness and as a clause in the
message ("This turn called no tool and served no result…") rather than fragmenting one class by how
easily it was noticed.

**Runnable example.**

```ts
import { priorTurnEvidenceOf } from './check.js';

const { findings, disposition } = priorTurnEvidenceOf(
  {
    fromThisTurn: 0, // nothing this turn fetched grounds the answer
    fromPriorTurns: 7, // …and seven values in it are grounded
    latestPriorTurn: 9,
    currentTurn: 13,
    toolResultsThisTurn: 0, // the strong tell: this turn fetched nothing at all
    indexTruncated: false,
  },
  1,
);
// disposition === 'checked-fail'
// → one advisory 'prior-turn-evidence' at seam 'claim', naming the count, the
//   turn they came from and the distance, with the ceiling sentence in its own
//   message. Nothing was blocked, revised or rewritten.
```
