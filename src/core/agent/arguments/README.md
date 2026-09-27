**Mixed** — the inputs layer (honesty layer 2): what a tool author declares about each argument, and what the library does, files and says when a call leaves one out.
Map: `declare.ts` (the declaration and its one assert), `rows.ts` (the `argument` row and its door check).
Walker: `resolve.ts` (the checks and the one table), `subflow.ts` (the four stages of `sf-inputs`), `dispatch.ts` (ToolCalls' half: the fills, the note, the rewrites' `changedKeys`, the fail-closed refusal).
Lens: `serve.ts` (the served schema sentence, the note on a result, the refusals, the "Assumed" block).

**The law.** No argument runs unaccounted for.

Every value on an argument a tool author ruled is one of: the person's, a tool result's,
the app's, or a default the LIBRARY filled and the answer admits. When none of these holds,
it is recorded as the model's own, and the answer's standing says so.

```ts
import { Agent, defineTool } from 'agentfootprint';

const searchLogs = defineTool({
  name: 'search_logs',
  description: 'Error lines for one service over a look-back period.',
  inputSchema: {
    type: 'object',
    required: ['service', 'window'], // the author's contract — never edited
    properties: {
      service: { type: 'string' },
      window: { type: 'string', enum: ['1h', '2h', '24h', '7d'] },
    },
  },
  askOrAssume: { window: { assume: '2h' } }, // the library fills it — never the tool
  period: { argument: 'window', spelling: 'lookback' },
  execute: async ({ service, window }) => search(service, window),
});

const agent = Agent.create({ provider, model }).tool(searchLogs).build();
await agent.run({ message: 'any errors on checkout?' }); // the model sends { service: 'checkout' }
agent.findings();            // [{ kind: 'argument', argument: 'window', source: 'default', value: '2h', turn: 1, … }]
(await agent.assessment())?.reasons.map((r) => r.reason); // ['argument-assumed']
```

The runnable example is `examples/features/74-ask-or-assume.ts`: the model leaves the
period out, the library fills `2h`, the tool runs with it, the record says so, the answer's
standing reads "not sure — assumed", and with `.limitsTravelWithTheAnswer()` the answer
itself carries an "Assumed" block.

## What happens to one ruled argument (this version)

| The value on the call | Row `source` | What runs |
|---|---|---|
| missing (`declare.ts` · `isMissing`) | `default`, no `proposed` | the call, with the declared default FILLED |
| present, the same value as the declared default (`declare.ts` · `sameArgumentValue`) | `default`, `proposed` = the model's | the call, as the model sent it |
| present, any other value | `model` | the call, as the model sent it — flagged |

A present value equal to the default is filed as `default`, never as the model's choice: a
model that copies a default from a description chose nothing. `proposed` tells the two
`default` rows apart. The model declares nothing about its values yet (`_findings.from`, the
declared sources, is a later step), so no value can be verified as the person's in this
version: every present value the default does not match reads `model`.

`{ ask: question, choices? }` is judged in full at definition and then REFUSED, naming the
step: the one ask per batch ships with the inputs layer's step 4, and a declaration must never
promise what the library cannot do.

## The seven clauses (the honesty layers' contract), as this step ships them

| Clause | Here |
|---|---|
| DECLARE | the tool author: `Tool.askOrAssume` and `Tool.period` (`ToolPeriod`), judged by ONE assert (`declare.ts` · `assertAskOrAssume`) at definition (`core/tools.ts` · `defineTool`), at dispatch (`declare.ts` · `rulesOf` — a Tool built by hand or served by a ToolProvider never passed `defineTool`) and at MCP ingest (`lib/mcp/toolExtras.ts` · `readToolExtras`, which judges each rule against the listed tool's own `inputSchema`). A rule is refused, never repaired: an argument the schema does not offer or whose type is not exactly one of `string`, `number`, `integer`, `boolean`; a `wants` argument; a value the PROPERTY's own schema rejects (never the root `required`); a period on an argument with no rule. |
| VERIFY | `resolve.ts` · `verifyPlan` — the table above; a pure function of the batch and the rules of the implementation that will run (`stages/toolResolver.ts` · `buildToolResolver`, the one dispatch resolver). |
| RECORD | `rows.ts` · `ArgumentRow` — one row per ruled argument per call, its value in the tool's OWN argument view (`core/toolShownArgs.ts` · `shownArgsOf`: a hidden argument reads `'REDACTED'`), stamped with the conversation `turn`. Merged into the ONE ledger (`AgentState.findingsLedger`) by the ledger's pure half (`findings/ledger.ts` · `appendRows`) in ONE write per batch, through the mount's output mapper (`honesty/mounts.ts` · `mountInputsLayer`); one `agentfootprint.findings.argument` event per row (names, enums and counts — never a value). |
| RESOLVE | `resolve.ts` · `resolutionsOf` — **assume** (fill the declared default) or **refuse** (the rules could not be read at dispatch). ToolCalls applies the entry after `tool_start` (which keeps the model's proposal) and BEFORE the permission check, so policy judges the call that will really run (`dispatch.ts` · `withFills`). A ruled tool met on an agent WITHOUT the layer is refused rather than run unruled (`dispatch.ts` · `unmountedRefusal`, the sentence `serve.ts` · `unmountedRulesRefusal`). Both refusals are decided after permission and BEFORE the before-tool middleware chain, so no middleware can ask a person about a call that will not run; the middleware-ask resume door re-applies both (`stages/toolCalls.ts` · `resume`). Inner dispatch (`ctx.tools.call`) refuses a ruled tool unless every ruled argument is given (`toolDispatch.ts` · `refuseUnaccountedRuledArguments`). |
| FOLD | the answer's standing (`assessment/assess.ts` · `readArgumentVerdicts`), this turn's rows only: a `default` row fires `argument-assumed`, a `model` row on a ruled argument fires `argument-unverified` — "not sure". A before-tool middleware that rewrote a ruled argument AFTER the layer checked it supersedes the row (its value is what ran): assumed, unless it declared the value the person's or the app's (`allow(args, why, { from })`; `middleware/outcomes.ts` · `allow`). The rewrites are read by ONE owner (`middleware/rewrites.ts` · `argumentRewritesOf`), which the "Assumed" block reads too. Every result the fold reads is the TOOL's own bytes (`lib/toolBytes.ts` · `toolBytesOf`), so a filled call's `[]` still fires `empty-undeclared`. No row here ever SUPPORTS "known". |
| SERVE | the model: the served schema drops an `assume`-ruled argument from `required` and says the rule (`serve.ts` · `withArgumentRules`); a call that ran on a filled value gets a past-tense note after the tool's own bytes (`serve.ts` · `filledNote`) — one clause per fill the call really ran with, so a fill a before-tool middleware rewrote is left out (`dispatch.ts` · `fillsThatRan`) — and its history message carries `toolChars`. Every reader of a result as the TOOL's words reads through that cut (`lib/toolBytes.ts` · `toolBytesOf`): the evidence gate, the answer's standing, the answer account, the unsupported-argument seam's grounds and the empty-lookup seam's producers — so the note grounds nothing and hides no reading of the result. The person: the rows, the event, the standing — and, only under `.limitsTravelWithTheAnswer()`, an "Assumed (a tool's rule, not your words)" block in the answer (`serve.ts` · `assumedBlockOf`), which leaves out a row a middleware rewrite superseded. |
| ARM + MEASURE | a REGISTERED tool that declares rules (`.tool()`, a skill's tools, an MCP tool registered on the builder) arms the mount; `AgentBuilder.inputsLayer()` arms it for ruled tools only a ToolProvider serves. Nothing declared → nothing mounted, decorated, read or written: every run is byte-identical (the 21 references in `test/core/tools/reference/`, plus two armed ones). The bench is honesty step 2's inputs bench, whose registered rule names step 3's clauses (the assumed value admitted on the record and in the standing; the person's periods, the facts and the overhead held). |

## Where the layer runs

```
… → CallLLM → [NormalizeThinking] → ⟨sf-inputs⟩ → Route ─┬─ tool-calls: ToolCalls (applies the fills) ──loopTo──▶
                                                          └─ final · …
sf-inputs = declare-arguments → verify-arguments → record-arguments → resolve-arguments
```

After the LLM call and before Route, once per BATCH, and it acts only when Route's own
predicate says the batch dispatches (`stages/route.ts` · `willDispatch`). It is handed the
batch (`llmLatestToolCalls`), the predicate's values and `turnNumber` — never the ledger,
never a tool (tools are closures, read through the shared resolver). It returns its rows and
`argumentResolutions` (one entry per call to fill or refuse, stamped with the batch's
iteration), both under `arrayMerge: Replace`.

## What a plain agent carries

The optional-family law of docs-next's site budget (`docs-next/scripts/check-site-budget.mjs`):
the layer's run-time code reaches a run through `import()` at the point the arm is known, so
a plain agent's graph never carries it.

| Loaded through `import()`, only when armed | Loaded by |
|---|---|
| `subflow.ts`, `resolve.ts` — the four stage bodies and their pure steps | the mount's stage wrappers (`honesty/mounts.ts`), on first use |
| `dispatch.ts` — the fills, the note, the rewrites' `changedKeys`, the fail-closed refusal | ToolCalls, once per batch under the arm; for a ruled tool on an agent without the layer, at that call |
| `serve.ts` — the served schema, the note and refusal sentences, the "Assumed" block | the tools slot and seed (the schema), `dispatch.ts`, the final branch's armed variant (`stages/prepareFinal.ts` · `prepareFinalWithLimitsAndAssumedStage`) |
| `middleware/rewrites.ts` — the one reading of a rewrite | `serve.ts` and the standing fold (`assessment/assess.ts`, itself loaded on first use) |

What stays on the default graph is what a SYNCHRONOUS door needs before anything is known to
be armed: the declaration and its one assert (`declare.ts` — `defineTool` refuses a malformed
declaration synchronously, at definition), the row's shape and its checkpoint check
(`rows.ts`, run by `validateCheckpoint`), the mount and the arm itself (`honesty/`,
`AgentBuilder.inputsLayer`, the charts), the turn stamp and the one-writer merge
(`findings/ledger.ts`), the tool-bytes cut (`lib/toolBytes.ts`) and
`allow(args, why, { from })`. Two small armed pieces stay static on purpose: the argument
row's event (`findings/ledger.ts` · `emitArgumentRow`, inside the one writer's emit half) and
the inner-dispatch refusal (`toolDispatch.ts` · `refuseUnaccountedRuledArguments`, which
refuses before `ctx.tools.call` takes its sequence number — an `await` there would reorder
concurrent inner calls). `test/lib/trace-toolpack/browserGraph.test.ts` pins the split.

## Refused, and what the model reads

| When | The call reads |
|---|---|
| its tool's rules cannot be read at dispatch (a hand-built or provider tool) | `search_logs was not run on that call: its argument rules could not be read (<the assert's reason>).` |
| its tool declares rules and the agent was built without the layer (a provider tool, no `.inputsLayer()`) | `search_logs was not run on that call: it declares argument rules this agent was not built to apply.` — and one warning naming `.inputsLayer()` |

Both land in the argument-refusal shape the validation refusal uses (`error: true`), after
permission, so policy still sees every attempted call, and before the before-tool middleware
chain, so no middleware can ask a person to approve a call the library will not run. A call
paused on a middleware `ask` resumes through its own door, which re-applies both refusals
before the rest of the chain runs.

## What it costs, measured

`test/core/agent/arguments/performance.test.ts` prints the day's numbers. On 2026-09-27, a
50-iteration run in which all 49 dispatched calls were filled — the worst case — committed
1,269,619 bytes armed against 934,386 unarmed (+35.9%) and 952 bundles against 852 (the
mount's two per iteration). Where the bytes went: +274 KB is the messages slot's
per-iteration record re-committing history, which now carries one note per filled call; the
ledger itself adds 7.7 KB (the delta encoding appends), `argumentResolutions` 4.9 KB, and the
two tool-result keys 16.6 KB. One ledger write per batch, never one per call. The merge
(`findings/ledger.ts` · `appendRows`) scales linearly to 1,000 rows. A run whose calls send
their own values pays the rows and the mount, not the notes.

## Not covered

- **Asking the person** — an `ask` rule is refused at definition until the batch ask ships
  (step 4). A missing value on such an argument is not asked; the declaration fails first.
- **Declared sources** — the model does not yet say where a value came from
  (`_findings.from`), so no value is verified as the person's, a result's or the app's; the
  hint lookups (`coincides`) arrive with them. Every present non-default value reads `model`.
- **A call that pauses and resumes** (a middleware `ask`, a check-in, a credential consent, a
  tool's own `requestInput`) carries the filled value into the pause (`pausedAskArgs`,
  `pausedCheckInArgs`, `pausedCredentialArgs`, `pausedToolArgs`) and its row is filed, but its
  resumed result carries no note and no `toolChars`: the note is appended by the batch loop
  only. The model is not told on that result; the record, the standing and the "Assumed"
  block still say it.
- **Rows for calls that then did not run.** A batch's rows are filed before anything
  dispatches, so a call that permission denies, a refusal stops, or a pause settles keeps its
  `default` row: the standing and the "Assumed" block may name an assumption for a call that
  did not run. They may over-report; they never hide.
- **Two calls of one batch that share a call id** (a malformed provider) share the layer's entry
  and rows, which are keyed by id — the record can contradict what ran. Keying by batch
  position is named, not built.
- **A placed result that ran on a filled value.** Two readers parse a placement ticket off the
  WHOLE message and do not read through the boundary: the staged-refs nudge
  (`core/agent/stagedRefs.ts` · `findStagedRefs`, which the served-view rebuild also runs on
  the stripped wire, where no boundary exists) and a standing row's `ref`
  (`findings/ledger.ts` · `placedRefOf`). After a note, the ticket no longer parses for them —
  as after any other framework suffix (a step boundary, an effect note, the repeated-call
  note) — so the nudge and the `ref` are left out; neither is ever wrong.
- **A middleware rewrite on a resumed chain** (after a middleware `ask`) is not stamped with
  `changedKeys`; the batch loop stamps them.
- **Nested or array arguments**, type unions and nullable types — not ruled in v1.
- **An author's wrong declaration** — a default the server does not honour yields an
  honest-looking row. Tool, app and person declarations are the trust base.
- **The turn stamp** is written on EVERY row the one writer files while the layer is armed
  (this layer's rows, and the basis, standing, contingent, judgment and conflict rows filed
  beside them); on an agent without the layer, no row changes. A recording made before the
  stamp existed has unstamped rows, which the fold reads by call id, as before.

## What it lets you measure

From the record alone, per model and per prompt or skill version: the **assumed-value rate**
(calls that ran on a default nobody chose — `default` rows over ruled-argument rows), the
**echoed-default rate** (the model sent the default itself — `default` rows that carry
`proposed`), the **model-chosen rate** (`model` rows), the share of answers whose standing
names an assumption (`argument-assumed`), and — from the performance test — what the layer
costs per iteration in commit-log bytes. These rows are what a bench over the layer scores
and what a lens draws — no second record is kept for either. The limit: it measures whose
value a call ran on, not whether that value was right.
