---
type: added
---
**The answer's standing, in the run: `.answerLayer()` (honesty layer 4).** The same fold `agent.assessment()` runs after a run — known · consistent with the record · not sure (with the reasons) · ask · not assessed, from the committed record, never from how sure the model sounded — now runs INSIDE the run, as the first stage of the final branch, and is served the moment the answer exists: `turn_end.answerAssessment` and one new event, `agentfootprint.answer.assessed` (the value, its word, the reason kinds and the checks that ran — never a value from the answer or a quote; new `answer.*` domain with its wildcard). The in-run standing equals `assessAnswer()` over the same recording read afterwards — pinned across pause and resume, a continued conversation, typed answers, the evidence revision, a limit that cut the turn short and an agent mounted in a composition.

```ts
const agent = Agent.create({ provider, model })
  .tool(listDownPorts)
  .answerLayer({ standingLine: true }) // .answerLayer() alone: the data only
  .build();
agent.on('agentfootprint.answer.assessed', (e) => console.log(e.payload.standing)); // 'not-sure'
await agent.run('Which ports on switch A are down?');
// 'No ports on switch A are down.\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.'
```

- While the layer is armed, the Route decider commits two **witness rows** on the findings ledger, so the fold can read verdicts that were events only: `grounded` (the evidence gate's clean pass — the names-and-numbers check RAN, which reads "consistent", never "known") and `steps-unfinished` (an answer accepted or cut short before a skill's declared steps finished — a new layer-4 reason). New exported types `GroundedRow` and `StepsUnfinishedRow` join `FindingsRow`; a reader that switches over every kind must skip one it does not know. An older runtime refuses a continued-conversation checkpoint that carries either kind.
- While any honesty layer is armed, every findings-ledger row carries its conversation `turn`, a continued conversation's ledger is restored, and a checkpoint carries the turn it ended on — new optional field `AgentRunCheckpoint.turnNumber` (both carriers: `agent.checkpoint()` and `RunCheckpointError.checkpoint`; version 1 still), so the stamp never repeats even when a window strategy trims the stored history. `resumeOnError` retries the same turn; `run({ continueFrom })` is the next one.
- `{ standingLine: true }` appends ONE line to a prose answer, after the limits separator, and never edits the model's words; beside `.limitsTravelWithTheAnswer()` the line names the assumed values itself instead of an "Assumed" block. Refused at build beside `.answerValidation()` and `.outputSchema()`, through `.answerLayer()` and `AgentOptions.answerLayer` alike. Every assumed value is printed — the line never cuts one.
- A **typed answer's limits** (`.outputSchema()` + `.limitsTravelWithTheAnswer()`) now carry the values a tool's `askOrAssume` rule filled: `agent.answerCoverage().assumed`, the same rows the prose "Assumed" block prints (new exported type `AnswerCoverage`, a `Coverage` plus that optional list). The block and the data are now two callers of ONE fold.
- The **answer account** (`accountForAnswer`) reads a typed answer's limits as data (`facts.limitsData`; `limitsBlock` says `missing: 'as-data'` instead of `not-applicable`), splits the framework's whole appended section off a prose answer (an "Assumed" block alone no longer reads as the model's words; a standing line is the library's only when the record shows the run appended exactly that line — a model's own "Not sure — …" stays its words), and renders the new reason (template set 5).
- Off by default: an agent without `.answerLayer()` builds the same chart and commits, emits and answers exactly what it did.
