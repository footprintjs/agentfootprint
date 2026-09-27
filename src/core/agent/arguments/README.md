**Mixed** — the inputs layer (honesty layer 2): what a tool author declares about each argument, and what the library does, files and says when a call leaves one out.
Map: `declare.ts` (the declaration and its one assert), `rows.ts` (the `argument` row and its door check), `kept.ts` (an answer a call could not use, kept for its next proposal), `askMarker.ts` (the library's own ask, recognised without loading it).
Walker: `resolve.ts` (the checks and the one table), `subflow.ts` (the four stages of `sf-inputs`), `ask.ts` (the one ask per batch: its fields, its declaration, the answer's binding, the re-ask).
Lens: `serve.ts` (the served schema sentence, the notes on a result, the refusals, the "Assumed" block).

**The law.** No argument runs unaccounted for.

Every value on an argument a tool author ruled is one of: the person's (their answer to the
library's ask), a tool result's, the app's, or a default the LIBRARY filled and the answer
admits. When none of these holds, it is recorded as the model's own, and the answer's
standing says so.

```ts
import { Agent, defineTool, isInputPause } from 'agentfootprint';

const searchLogs = defineTool({
  name: 'search_logs',
  description: 'Error lines for one service over a look-back period.',
  inputSchema: {
    type: 'object',
    required: ['service', 'window'], // the author's contract — never edited
    properties: {
      service: { type: 'string' },
      window: { type: 'string', enum: ['1h', '24h', '7d'] },
    },
  },
  // ask the PERSON — or `{ assume: '24h' }` to have the library fill a declared default
  askOrAssume: { window: { ask: 'Which period should the search cover?', choices: ['1h', '24h', '7d'] } },
  period: { argument: 'window', spelling: 'lookback' },
  execute: async ({ service, window }) => search(service, window),
});

const agent = Agent.create({ provider, model }).tool(searchLogs).build();
const out = await agent.run({ message: 'any errors on checkout?' }); // the model sends { service: 'checkout' }
if (isInputPause(out)) {
  out.awaitingInput.fields; // [{ id: 'f1', type: 'string', enum: ['1h', '24h', '7d'], description: 'Which period…?', … }]
  await agent.resume(out.checkpoint, { requestId: out.awaitingInput.requestId, values: { f1: '7d' } });
}
agent.findings(); // [{ argument: 'window', asked: 'missing', … }, { argument: 'window', source: 'answered', value: '7d', … }]
```

The runnable examples are `examples/features/74-ask-or-assume.ts` (the model leaves the
period out, the library fills `2h`, the answer's standing reads "not sure — assumed") and
`examples/features/75-ask-for-missing-arguments.ts` (two calls leave the period out, the
person is asked ONCE, both calls run with the answer, and the standing reads "ask" until it
comes).

## What happens to one ruled argument (this version)

| The value on the call | `assume` rule | `ask` rule |
|---|---|---|
| missing (`declare.ts` · `isMissing`) | `default`, no `proposed` — the call runs with the declared default FILLED | `asked: 'missing'` — the person is asked, ONCE for the whole batch, before anything in it runs; the answer files `answered` and the call runs with it |
| missing, and this turn KEPT the person's answer for this (tool, argument) (`kept.ts`, below) | — | `answered` — the kept answer is FILLED, nobody is asked again |
| present, the same value as the declared default (`declare.ts` · `sameArgumentValue`) | `default`, `proposed` = the model's — the call runs as sent | — (an `ask` rule has no default) |
| present, any other value | `model` — runs as sent, flagged | `model` — runs as sent, flagged |

A present value equal to the default is filed as `default`, never as the model's choice: a
model that copies a default from a description chose nothing. `proposed` tells the two
`default` rows apart. The model declares nothing about its values yet (`_findings.from`, the
declared sources, is a later step), so no present value can be verified as the person's in
this version: every present value a default does not match reads `model` — and an `ask`
argument's present value is NOT asked about (adopted Q2): with nothing to check it against,
the ask would fire on nearly every call, including when the person already said the value.

## The batch ask — once, before anything runs

The layer names, per call, the `ask` arguments the call left out (`resolve.ts` ·
`ArgumentResolution`'s `ask`). The dispatch stage then asks the person for ALL of them at
once, before anything in the batch is written or run (`stages/argumentAsk.ts` ·
`askBeforeDispatch`, over the pure `ask.ts`):

- **The typed ask `requestInput` uses** (`core/inputRequest.ts`): `isInputPause(outcome)`,
  `outcome.awaitingInput`, `agent.resume(outcome.checkpoint, { requestId, values })`;
  `standingAgent` renders, answers and cancels it like any other. A partial answer is kept at
  `Agent.resume`'s door and nothing runs.
- **One field per distinct (tool, argument)**, bound to every call of the batch that needs
  it (`ask.ts` · `planAskFields`). Field ids are positional (`f1`, `f2`, …); the question is
  fixed (`ask.ts` · `ARGUMENT_ASK_QUESTION`) and each author's question is its field's
  `description`, its choices the field's `enum`. `context.agentfootprint = { ask: 'arguments',
  fields: [{ id, tool, argument, calls }] }` says what each field is for — the library's
  reserved key (`ask.ts` · `isArgumentAsk`). `AgentOptions.argumentAskContext` spreads the
  host's own state beside it (`ask.ts` · `judgeAskContextHook` refuses the reserved key).
- **One period, one question.** Two period arguments of different tools share a field when
  their spellings convert (`lookback` ↔ `signed-lookback`) and their choices are the same
  periods (`ask.ts` · `periodsShareField`); each call is filled in its OWN spelling. An
  `iso-range` never merges.
- **Nothing the model proposed rides the ask** — no value, no `supplied`, no choice it wrote.
- **The answer is re-checked** against the PROPERTY's own schema of every argument it binds
  to (`ask.ts` · `checkAnswer`, through the one validator,
  `toolArgsValidation.ts` · `validatePropertyValue`): an integer answered `2.5`, a string that
  breaks its `pattern`. One that does not fit files `asked: 'invalid-answer'` and is asked
  again with a second fixed question (`ask.ts` · `ARGUMENT_REASK_QUESTION`), at most
  `ask.ts` · `MAX_ASK_ROUNDS` (three) times; then the calls that needed it are refused by
  name (`serve.ts` · `unansweredRefusal`). More than 32 fields go in rounds of 32.
- **The resume adds no model call.** The answered values are filled like a declared default
  (`ArgumentFill.source: 'answered'`), each call runs on its ordinary path — permission,
  middleware, validation, check-in, credentials — and its result carries a past-tense note
  (`serve.ts` · `filledNote`: "window = "7d" … was chosen by the person when asked").
- **One human question per resume — and the answer is KEPT.** The resume re-runs the batch,
  so a later call of the SAME batch that needs a person — a check-in, a middleware `ask`, a
  credential consent, the tool's own `requestInput` — is refused by name (`serve.ts` ·
  `secondPauseRefusal`, the middleware chain's own refusal, the credential's `'tell-model'`
  sentence). When that call carried the person's answers, they are KEPT for the rest of the
  turn (`kept.ts` · `KeptAnswer`, `AgentState.argumentAnswersKept`), and the refusal tells the
  model so (`serve.ts` · `keptAnswersNote`: "The person's answer for window was kept for the
  next purge_logs call that leaves it out, so the call may be proposed again without window." —
  past tense, so it stays true when re-read after the answer is used; the credential's sentence
  is left as it is). The next call of the same tool that leaves the same argument out is FILLED
  from the kept answer by the layer's one table (`resolve.ts` · `verifyPlan`, re-checked
  against the property's own schema; filed `answered`, with no `asked` row — nobody was asked
  in that batch), so its batch asks nothing and its own step pauses there as it always does.
  A tool with both an `ask` rule and a check-in therefore costs the person two round trips:
  the ask, then the check-in on the call proposed again. A kept answer is used ONCE — the batch
  whose calls filled from it drops it (`stages/toolCalls.ts` · `dropUsedKept`), and only
  another refusal by the same law keeps it again; every other batch asks as the layer always
  asks. Without it the model's next proposal, leaving the argument out as the served schema
  says, would be asked the same question again and refused again, every batch.

**Why the dispatch stage raises it.** The layer's subflow decides what to ask; ToolCalls
raises it, through footprintjs's `interrupt()`, as the first thing it does. ToolCalls is the
one stage of the ReAct loop whose resume continues the loop (it is the branch that loops, so
the continuation after it IS the loop head), and inside a composition it sits one subflow
deep, where a resume re-enters it cleanly. A pause raised inside `sf-inputs` itself — the
design's first placement — resumes, on footprintjs 9.26–9.27, into a traversal that cannot
reach the loop head: the loop-back resolves to its reference stub and the run ends silently
after one stage. The fix for that belongs to footprintjs (the minimal chart is fact 2 of the
tripwire, `test/core/agent/arguments/ask-placement.test.ts`); until it ships, the pause lives
where footprintjs resumes it correctly.

## The seven clauses (the honesty layers' contract), as this version ships them

| Clause | Here |
|---|---|
| DECLARE | the tool author: `Tool.askOrAssume` (`{ assume }` or `{ ask, choices? }`) and `Tool.period` (`ToolPeriod`), judged by ONE assert (`declare.ts` · `assertAskOrAssume`) at definition (`core/tools.ts` · `defineTool`), at dispatch (`declare.ts` · `rulesOf` — a Tool built by hand or served by a ToolProvider never passed `defineTool`) and at MCP ingest (`lib/mcp/toolExtras.ts` · `readToolExtras`, which judges each rule against the listed tool's own `inputSchema`). A rule is refused, never repaired: an argument the schema does not offer or whose type is not exactly one of `string`, `number`, `integer`, `boolean`; a `wants` argument; a value or choice the PROPERTY's own schema rejects (never the root `required`); a period on an argument with no rule. The host declares its own ask context (`AgentOptions.argumentAskContext`). |
| VERIFY | `resolve.ts` · `verifyPlan` — the table above; a pure function of the batch and the rules of the implementation that will run (`stages/toolResolver.ts` · `buildToolResolver`, the one dispatch resolver). The person's answer: `ask.ts` · `checkAnswer`, the property's own schema. |
| RECORD | `rows.ts` · `ArgumentRow` — one row per ruled argument per call, its value in the tool's OWN argument view (`core/toolShownArgs.ts` · `shownArgsOf`: a hidden argument reads `'REDACTED'`), stamped with the conversation `turn`: `default`, `model`, `asked` (`missing`, `invalid-answer`; no value), `answered` (`free` for a free-text field; filed by the layer itself, with no `asked` row, when a kept answer fills the value). The layer's rows are merged into the ONE ledger (`AgentState.findingsLedger`) by the ledger's pure half (`findings/ledger.ts` · `appendRows`) in ONE write per batch, through the mount's output mapper (`honesty/mounts.ts` · `mountInputsLayer`); the ask's `answered` and `invalid-answer` rows through the one writer (`findings/ledger.ts` · `recordFindings`), once per answer. One `agentfootprint.findings.argument` event per row (names, enums and counts — never a value). The `agentfootprint.pause.resume` event of the library's own ask carries the reply's shape with every value `'REDACTED'` (`askMarker.ts` · `argumentAskReplyForEvent`, read in `core/RunnerBase.ts` · `emitPauseResume`), because an answer may fill an argument the tool's view hides. |
| RESOLVE | **assume** (fill the declared default — `resolve.ts` · `resolutionsOf`), **ask** (the batch ask, `stages/argumentAsk.ts` · `askBeforeDispatch`), **refuse** (rules that cannot be read at dispatch; answers that never fit). ToolCalls applies each entry after `tool_start` (which keeps the model's proposal) and BEFORE the permission check, so policy judges the call that will really run (`stages/toolCalls.ts` · `withFills`). A ruled tool met on an agent WITHOUT the layer is refused rather than run unruled (`serve.ts` · `unmountedRulesRefusal`). The refusals are decided after permission and BEFORE the before-tool middleware chain, so no middleware can ask a person about a call that will not run; the middleware-ask resume door re-applies them (`stages/toolCalls.ts` · `resume`). Inner dispatch (`ctx.tools.call`) refuses a ruled tool unless every ruled argument is given (`toolDispatch.ts` · `refuseUnaccountedRuledArguments`). |
| FOLD | the answer's standing (`assessment/assess.ts` · `readArgumentVerdicts`, `readArgumentAsk`), this turn's rows only: a `default` row fires `argument-assumed`, a `model` row on a ruled argument fires `argument-unverified` — "not sure"; the batch ask still waiting (`AgentState.argumentAsk`'s `waiting`, with this turn's `asked` rows as witnesses) fires `argument-asked` — "ask". An `answered` row fires nothing and supports nothing. A before-tool middleware that rewrote a ruled argument AFTER the layer checked it supersedes the row: assumed, unless it declared the value the person's or the app's (`allow(args, why, { from })`; `middleware/outcomes.ts` · `allow`), read by ONE owner (`middleware/rewrites.ts` · `argumentRewritesOf`). Every result the fold reads is the TOOL's own bytes (`lib/toolBytes.ts` · `toolBytesOf`). No row here ever SUPPORTS "known". |
| SERVE | the model: the served schema drops a ruled argument from `required` and says the rule (`serve.ts` · `withArgumentRules`, `ASK_SENTENCE`); a call that ran on a filled value gets a past-tense note after the tool's own bytes (`serve.ts` · `filledNote`) — one clause per fill the call really ran with (`stages/toolCalls.ts` · `fillsThatRan`) — and its history message carries `toolChars`, the cut every reader of a result as the TOOL's words reads through (`lib/toolBytes.ts` · `toolBytesOf`). The person: the typed ask; the rows, the event, the standing — and, only under `.limitsTravelWithTheAnswer()`, an "Assumed (a tool's rule, not your words)" block (`serve.ts` · `assumedBlock`). The evidence gate treats a declared default as the app's words and an answered value as the person's (`evidence/evidenceIndex.ts` · `exemptFromRun`, `stages/route.ts` · `answeredValuesOf`). |
| ARM + MEASURE | a REGISTERED tool that declares rules (`.tool()`, a skill's tools, an MCP tool registered on the builder) arms the mount; `AgentBuilder.inputsLayer()` arms it for ruled tools only a ToolProvider serves. Nothing declared → nothing mounted, decorated, read or written: every run is byte-identical (the 21 references in `test/core/tools/reference/`), and an agent whose tools declare only `assume` rules is byte-identical to step 3 (its two references). The ask's code loads through `import()` when an ask is raised. The bench is honesty step 2's inputs bench, whose registered rule names step 4's clauses (the share of period calls that ran with the value the person meant, the needless asks on the controls, the facts, the overhead). |

## Where the layer runs

```
… → CallLLM → [NormalizeThinking] → ⟨sf-inputs⟩ → Route ─┬─ tool-calls: ToolCalls (the ask, then the fills) ──loopTo──▶
                                                          └─ final · …
sf-inputs = declare-arguments → verify-arguments → record-arguments → resolve-arguments
```

After the LLM call and before Route, once per BATCH, and it acts only when Route's own
predicate says the batch dispatches (`stages/route.ts` · `willDispatch`). It is handed the
batch (`llmLatestToolCalls`), the predicate's values and `turnNumber` — never the ledger,
never a tool (tools are closures, read through the shared resolver). It returns its rows and
`argumentResolutions` (one entry per call to fill, ask about or refuse, stamped with the
batch's iteration), both under `arrayMerge: Replace`. The four stage bodies load through
`import()` on first use, so a plain agent's graph never carries them. ToolCalls reads the
entries of THIS batch, raises the batch ask first when an entry names one, and keeps the
ask's working state in `AgentState.argumentAsk` until it settles.

## Refused, and what the model reads

| When | The call reads |
|---|---|
| its tool's rules cannot be read at dispatch (a hand-built or provider tool) | `search_logs was not run on that call: its argument rules could not be read (<the assert's reason>).` |
| its tool declares rules and the agent was built without the layer (a provider tool, no `.inputsLayer()`) | `search_logs was not run on that call: it declares argument rules this agent was not built to apply.` — and one warning naming `.inputsLayer()` |
| the person's answers for an `ask` argument never fitted the property's schema, three times | `top_talkers was not run on that call: the person's answers for limit did not fit what the tool accepts (limit: integer).` |
| it needed a second pause — its check-in tripped, or the tool itself asked to pause — in a batch that already paused for the library's ask | `purge_logs was not run to completion on that call: its check-in consent gate needed a person’s approval for those arguments, and this batch had already paused once — to ask the person for argument values — so there was no second pause to ask with.` — and, when the call carried the person's answers (they are kept): ` The person's answer for window was kept for the next purge_logs call that leaves it out, so the call may be proposed again without window.` The middleware chain's own refusal of an `ask` gains the same clause. |

The first three land in the argument-refusal shape the validation refusal uses (`error:
true`), after permission, so policy still sees every attempted call, and before the
before-tool middleware chain.

## What it costs, measured

`test/core/agent/arguments/performance.test.ts` prints the day's numbers. On 2026-09-27, a
50-iteration run in which all 49 dispatched calls were filled — the worst case — committed
1,269,619 bytes armed against 934,386 unarmed (+35.9%) and 952 bundles against 852 (the
mount's two per iteration). Where the bytes went: +274 KB is the messages slot's
per-iteration record re-committing history, which now carries one note per filled call; the
ledger itself adds 7.7 KB (the delta encoding appends), `argumentResolutions` 4.9 KB, and the
two tool-result keys 16.6 KB. One ledger write per batch, never one per call — two when the
batch asked (the layer's, then the answer's). The merge (`findings/ledger.ts` ·
`appendRows`) scales linearly to 1,000 rows. The batch ask: planning, building and
validating a 32-field ask costs well under a millisecond (`test/core/agent/arguments/ask.test.ts`,
the PERFORMANCE block), and the resume adds no model call.

## Not covered

- **Asking about a PRESENT value** — a value on an `ask` argument the model did send runs as
  sent, filed `model`, until the model can declare where it came from (`_findings.from`, the
  declared-sources step); only then is an unverified value asked about.
- **Declared sources** — no value is verified as the person's words, a result's or the app's;
  the hint lookups (`coincides`) arrive with them.
- **A second human question in the batch that asked** — refused by name (above), never asked:
  the batch's one question was the library's. A tool that both carries a `checkIn` and an
  `ask` rule therefore reads a refusal after the ask; its answer is kept, and it pauses for
  its check-in when the model proposes it again (the kept answer fills the argument, so that
  batch asks nothing). If the model does not propose it again, the tool does not run. The
  refused pass may have done part of its work (a tool that raised its own `requestInput`
  ran up to the raise), and the call proposed again runs it again.
- **A credential consent in the batch that asked, under the default `'pause'`.** The model
  reads the credential's own `'tell-model'` sentence (`identity/consent.ts` ·
  `modelRefusal`) and the consent is recorded as outstanding: a turn that ends WITHOUT a
  later call obtaining the credential raises `CredentialConsentRequiredError` (carrying the
  authorization URL to the caller) instead of returning the model's answer. A call proposed
  again runs on the kept answer and pauses for consent as `'pause'` always does.
- **A kept answer serves the call proposed again, not every later call.** It is dropped by the
  batch that fills from it; a later call of the same tool in another batch is asked again,
  like every batch. A kept answer is read only in its own turn, and a period kept for one tool
  does not fill another tool's period argument (one field shares a period only within a
  batch).
- **The RAW answers live in working state.** The calls must run with them, so they are held
  where the run keeps its other raw arguments — never on a row, an event, a served note or
  the ask's `context`: the batch ask's `AgentState.argumentAsk` holds the answers bound so far
  while a re-ask (or a second round of 32 fields) is out; `AgentState.argumentAnswersKept` a
  kept answer until it is used; `argumentResolutions` a kept answer's fill for its batch; and a
  call that then pauses on its own carries its completed arguments in the pause carriers
  (`pausedCheckInArgs`, …). A full recording of such a run carries that state, as it carries
  those carriers; a single-round ask whose calls run holds no answer in committed state. A tool
  that must keep a value out of recordings too needs a redaction policy on the run, which an
  Agent does not expose (arguments note § 5.1).
- **A kept answer that reaches a check-in rides the check-in's own evidence pack.** The
  check-in shows the person the arguments the call will run with (`core/checkin.ts` ·
  `CheckInRequest`, on its `checkin.request` event and its pause), and it does not read the
  tool's argument view — for a kept answer as for any other value. So when an argument the
  tool's view hides is answered, kept, and then reaches that tool's check-in, the evidence pack
  carries the raw value. Reading the view there is a change to the check-in, not to this layer.
- **A raised miss behind a refused second pause.** A tool whose own `requestInput` carries an
  `absence` in the batch that asked settles as the refusal; that miss is not filed.
- **Numeric bounds** (`minimum`, `maximum`) are not judged on the person's answer: the one
  validator's honest subset ignores them (`toolArgsValidation.ts`, its header), at definition,
  at the re-check and at dispatch alike. The tool receives the value and may refuse it.
- **A hidden answer at the evidence gate.** An answered value the tool's view hides is not
  exempt — its row holds the placeholder — so an answer that repeats it may be flagged. And an
  answer bound while its tool's name resolves to nothing (a provider tool not yet re-listed on
  a fresh instance) is shown as hidden on its row: there is no view to ask.
- **A composition's resume** (`Sequence.resume`, …) has no door: a reply must answer every
  field of the library's ask at once (`ask.ts` · `readAskAnswer` refuses a partial one), and it
  is validated inside the run by the same validator the door uses.
- **A call that pauses and resumes** (a middleware `ask`, a check-in, a credential consent, a
  tool's own `requestInput`) in a batch that did NOT ask carries the filled value into the
  pause (`pausedAskArgs`, `pausedCheckInArgs`, `pausedCredentialArgs`, `pausedToolArgs`) and
  its row is filed, but its resumed result carries no note and no `toolChars`: the note is
  appended by the batch loop only.
- **Rows for calls that then did not run.** A batch's rows are filed before anything
  dispatches, so a call that permission denies, a refusal stops, or a pause settles keeps its
  `default` or `answered` row: the standing and the "Assumed" block may name a value for a call
  that did not run. They may over-report; they never hide.
- **Two calls of one batch that share a call id** (a malformed provider) share the layer's entry
  and rows, which are keyed by id — the record can contradict what ran. Keying by batch
  position is named, not built.
- **A placed result that ran on a filled value.** Two readers parse a placement ticket off the
  WHOLE message and do not read through the boundary: the staged-refs nudge
  (`core/agent/stagedRefs.ts` · `findStagedRefs`) and a standing row's `ref`
  (`findings/ledger.ts` · `placedRefOf`). After a note, the ticket no longer parses for them —
  as after any other framework suffix — so the nudge and the `ref` are left out; neither is
  ever wrong.
- **A middleware rewrite on a resumed chain** (after a middleware `ask`) is not stamped with
  `changedKeys`; the batch loop stamps them.
- **Nested or array arguments**, type unions and nullable types — not ruled in v1.
- **An author's wrong declaration** — a default the server does not honour, a choice list
  that leaves out the period the person means — yields an honest-looking row. Tool, app and
  person declarations are the trust base.
- **The turn stamp** is written on EVERY row the one writer files while the layer is armed
  (this layer's rows, and the basis, standing, contingent, judgment and conflict rows filed
  beside them); on an agent without the layer, no row changes.

## What it lets you measure

From the record alone, per model and per prompt or skill version: the **assumed-value rate**
(calls that ran on a default nobody chose — `default` rows over ruled-argument rows), the
**echoed-default rate** (the model sent the default itself — `default` rows that carry
`proposed`), the **model-chosen rate** (`model` rows), the **ask rate** (batches that asked —
`asked: 'missing'` rows, grouped by call and iteration), the **answered rate** (`answered`
over `asked` rows), the **kept-answer uses** (an `answered` row with no `asked` row for its
call and iteration: a call proposed again after the one-question law refused it, filled from
the kept answer — nobody was asked in that batch) and the **free-text share** (`free`), the **invalid-answer rate** and the
calls refused after three (`asked: 'invalid-answer'`), the share of answers whose standing
names an assumption (`argument-assumed`) or ended waiting on the library (`argument-asked`),
and — from the performance tests — what the layer costs per iteration in commit-log bytes and
what a 32-field ask costs to build. The **needless-ask rate** (the library asked for a value
the person had already given) is read from the same `asked` rows beside a case label: the
record says what was asked, the bench says whether the person had said it. These rows are
what a bench over the layer scores and what a lens draws — no second record is kept for
either. The limit: it measures whose value a call ran on, not whether that value was right.
