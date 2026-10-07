---
type: fixed
---

**A composed agent's answer and its terminal verdict both now reach the composition correctly.** An agent mounted in a `Sequence`, `workflow()`, `Conditional`, `Loop`, `Parallel` or `graph()` never reaches its own run boundary, which is where the records it ends on become typed errors: a reliability fail-fast, a policy halt, a denied message (input or output), an answer-validation refusal, an evidence-rails refusal. The composition carried on as if the agent had answered. `Sequence.step('a', agent).step('b', next)` ran `next` on an empty input and returned its answer, `workflow()` and `graph()` passed the agent's state on as input, and `Parallel` counted the branch as a success. A validated agent's real answer did not survive either: it arrived as `''`, or as an object. Now the agent reads its own outcome from what its chart handed back. The answer comes from a result, and a verdict only from state. `Sequence`, `workflow()`, `Conditional` and `Loop` raise the SAME error the agent raises on its own (class, message, payload) before anything after it runs. `Parallel` and `graph()` report the branch or node as failed through their merge or join, and pass a delivered answer on as its text. This holds in every `reactMode`.

Behaviour changes:

- These compositions now reject where they used to resolve.
- An answer-validation refusal now enters the final branch and is withheld there. It used to break in the decider. Its trace shows the branch, the `'final'` decision and Route's narrative.
- The answer layer no longer assesses a withheld validated answer.
- An evidence-rails refusal is still recorded on `turn_end`, now flagged `refused: { by: 'evidence-rails' }`. It is no longer written to memory or returned as the chart's result.
- Every `'rails'` turn reads `unsupportedValues` once more.
- With the answer layer and answer validation, AssessAnswer reads the validation guard's keys.

Known gaps:

- The composed error carries no `snapshot`.
- A `'tell-model'` credential-consent record travels off tracked state, so a composition does not see it.
