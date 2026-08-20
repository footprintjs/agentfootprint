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

**Planned next** (see the decomposition in the program ledger): the assertion substrate, the one
visible `ContextError` finding type (kinds: `invariant-violation`, `unsupported-argument`,
`dangling-reference`, `duplicate-execution`, `unsupported-claim`), and the five checks at their
seams (write / compose / wire / choice / claim).

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
