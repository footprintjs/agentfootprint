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
| `assertion/` | the substrate — one typed claim per `(subject, predicate, epoch)`, the strata rule, and the single-valued comparison every check runs over |
| `finding/` | the ONE visible `ContextError` shape and its identity-keyed dedup |
| `invariant-violation/` | two channels asserting things that cannot both be true — at the write that created it, and at the wire the request actually crossed |
| `dangling-reference/` | an action still offered after the evidence its arguments come from left the window |
| `unsupported-argument/` | the value the model chose for an armed call, against everything the run served it |
| `unsupported-claim/` | the answer, against the typed facts the run's own tools settled |
| `empty-lookup/` | the run itself produced the identifier, and the lookup keyed on it came back empty — an ADVISORY, because an empty answer can be perfectly true |
| `column-types/` | the tool declared what its rows contain (`Tool.resultColumns`) and the rows say otherwise — `column-type-mismatch` (wrong type) and `missing-column` (declared, never delivered), bounded by a ceiling that judges TYPE and never MEANING |
| `argumentLeaves.ts` | the shared leaf: what "a string argument" means, so the two checks that read a call's arguments cannot drift apart about it |

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
