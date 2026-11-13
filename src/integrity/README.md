**Fold** — what may be claimed about a run's context now: typed assertions
folded into decidable contradictions, one visible `ContextError` shape, and a
disposition ledger that makes "no check ran" a different observable state from
"nothing was wrong".

# integrity — the Context Integrity family

**Why.** LLM agents treat context as text, but context behaves like runtime state. Ordinary
software protects correctness with typed state, invariants and runtime checks; agents protect it
with conversation history and prose — so failures that any other system would catch as invariant
violations surface as inexplicable model behaviour. In one recorded 30-call turn: a suspended
subsystem's tools stayed on the wire (invariant violation), eleven identifiers left the window
and one was invented (an offered action's inputs went out of scope), a completed four-step
sequence ran again (duplicate execution), and the final answer denied work the ledger recorded
(incorrect system log).

**The bound, stated up front and kept visible everywhere this family reports:** typed facts make
contradictions _representable_; declared annotations make them _decidable_. **Green means no
registered check was violated. It does not mean no context error exists.** Missing annotations
create false negatives while the checker still looks authoritative — which is why the
disposition accounting below is the first unit built, not the last.

**Units (growing; each folder has one job and its own README):**

| folder         | one job                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disposition/` | per-check accounting — checked-pass / checked-fail / not-applicable / unreachable — so "zero findings" and "zero checks ran" are different observable states, with the dev-posture canary and `assertAlive()` |
| `assertion/` | the substrate — one typed claim per `(subject, predicate, epoch)` (the claim type most checks are written in) and the strata rule; plus the single-valued comparison (`conflicts.ts` · `conflictsOf`), which only `invariant-violation/`, `unsupported-claim/` and the findings ledger (`core/agent/findings/ledger.ts`) run — the other checks decide by their own rules |
| `finding/` | the ONE visible `ContextError` shape and its identity-keyed dedup |
| `invariant-violation/` | two channels asserting things that cannot both be true — at the write that created it, and at the wire the request actually crossed |
| `dangling-reference/` | an action still offered after the evidence its arguments come from left the window |
| `unsupported-argument/` | the value the model chose for an armed call, against everything the run served it |
| `unsupported-claim/` | the answer, against the typed facts the run's own tools settled |
| `empty-lookup/` | the run itself produced the identifier, and the lookup keyed on it came back empty — an ADVISORY, because an empty answer can be perfectly true |
| `column-types/` | the tool declared what its rows contain (`Tool.resultColumns`) and the rows say otherwise — `column-type-mismatch` (wrong type) and `missing-column` (declared, never delivered), bounded by a ceiling that judges TYPE and never MEANING |
| `prior-turn-evidence/` | the answer is grounded and NOTHING this turn fetched grounds it — every value was last served in an earlier turn. An ADVISORY, because referring back is ordinary conversation and nothing here can tell a legitimate reference from a stale one |
| `negative-claim/` | "none", "not found" and "the list is complete", against what the search was made of — a typed claim CITES the reads it rests on and is established only from them, with the library's statement; a prose claim is only NOTED. The checkers are pure; they run only on an agent built with `.negativeClaims()`, which mounts them through `core/agent/negativeClaims/` (`delivery.ts` judges typed claims, `prose.ts` notes prose ones) and files `negative-claim` rows. Without `.negativeClaims()` nothing calls them |
| `claim-binding/` | captures the exact evidence one executed tool call returned and served, and binds a claim to it — selection only; the comparison stays `assertion/`'s. Today only its result-identity reader runs (`claim-binding/capture.ts` · `readResultIdentity`, used by `core/agent/negativeClaims/`); the full binding is used by `core/agent/findings/verification*.ts`, which no public option mounts yet (`core/agent/findings/README.md`, "Unreleased exact-claim protocol") |
| `argumentLeaves.ts` | the shared leaf: what "a string argument" means, so the two checks that read a call's arguments cannot drift apart about it |

## The check contract

A check is one folder and one row. The row lives in
`core/agent/assessment/integrityReasons.ts` · `INTEGRITY_FINDINGS`, keyed by finding kind, so a new
kind without a row does not compile and a test reads the union from its source. Each row says what
the finding does to **the answer's standing** (`effect`: a reason, or a `note` that moves nothing),
what the check reads (`reads`: `tool-declaration`, `record`, `model-declaration`) and who decides
(`decidedBy`: `code`, `your-rule`, `model-then-code`).

**The reader's order is STAND; the run's order is the layer's.** The reader's question comes in the
order State · Trace · Assess · Name · Decide. The run executes DECLARE → VERIFY → RECORD → RESOLVE →
FOLD → SERVE (`docs/design/honesty/README.md` § 2.1). Beside each other, with the smallest check
that files a finding, `empty-lookup`:

| STAND | Run order | What a check owes | `empty-lookup` |
|---|---|---|---|
| **State** — what was promised, before the run | DECLARE | Its arm, and what it reads. Unarmed is a registered `not-applicable` row, never silence | `Tool.argumentsFrom` plus the `noticeEmptyLookups` dial (`disposition/lifecycle.ts`). Row: `reads: ['tool-declaration', 'record']`, `decidedBy: 'code'` |
| **Trace** — what the run did | RECORD | One disposition per encounter, one `ContextError` per defect on the one rail, one committed row while the answer layer is armed. The row holds names, never a value | `empty-lookup/check.ts` · `emptyLookupOf`, filed by `core/agent/integrityFindings.ts` · `fileIntegrityFindings`; the row is `finding/row.ts` · `integrityFindingRowOf` |
| **Assess** — what the two say together | VERIFY | One pure rule over declared inputs. A deterministic test, or a verdict of `not-applicable` or `unreachable` | the run produced the identifier, and the lookup keyed on it came back empty |
| **Name** — the word for it | FOLD | Its row in the table: a reason with its witness, or a note. `reasons.ts` holds the reason's layer, class and source | `effect: 'note'`: an empty answer can be true, so this is a place to look. The standing does not move; `AnswerAssessment.notes` carries it |
| **Decide** — what happens next | RESOLVE, SERVE | Whether it stops anything. A check here never does: it files, and the app reads the standing as data | nothing blocks the call or changes the result; the note is on `agent.assessment()` and `assessAnswer(recording)` |

**Where a row is filed.** The answer's standing reads committed rows, never events. The compose, wire
and choice seams run inside subflows that cannot write the ledger, so a seam holds its row on
`integrityFindingRows`, and the Route decider files every held row through the one writer
(`findings/ledger.ts` · `recordFindings`), once per decision, before the final branch folds.

**A kind that must not lower the standing says why in the table's header**, not per run: a note is a
place to look (`dangling-reference` fires at offer time for a tool the model may never call;
`empty-lookup` and `prior-turn-evidence` are advisory by construction).

`negative-claim` is not on this table: it files its own rows and reports, and `reasons.ts` reads them.

**Still unclaimed:** `duplicate-execution` (did settled work again) is named by the finding type and
has no check in this build. That is stated everywhere it matters rather than hidden —
`find_context_errors` refuses to answer about it instead of returning a clean-sounding negative.

**Runnable example.**

```ts
import { dispositionLedger } from './disposition/ledger.js';

const ledger = dispositionLedger();
ledger.register('duplicate-execution', 'choice');

// each encounter files exactly one disposition
ledger.note('duplicate-execution', 'choice', 'checked-pass');
ledger.note('duplicate-execution', 'choice', 'checked-fail', Date.now());

// the wiring-rot alarm: a registered check that filed NOTHING while work
// existed fails the run — silence is a state, not an absence
ledger.assertAlive({ workExisted: true });
```
