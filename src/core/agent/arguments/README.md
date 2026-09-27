**Mixed** — the inputs layer (honesty layer 2): what a tool author declares about each argument, and what the library does, files and says when a call leaves one out.
Map: `declare.ts` (the declaration and its one assert), `rows.ts` (the `argument` row and its door check).
Walker: `resolve.ts` (the checks and the one table), `subflow.ts` (the four stages of `sf-inputs`).
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
| RESOLVE | `resolve.ts` · `resolutionsOf` — **assume** (fill the declared default) or **refuse** (the rules could not be read at dispatch). ToolCalls applies the entry after `tool_start` (which keeps the model's proposal) and BEFORE the permission check, so policy judges the call that will really run (`stages/toolCalls.ts` · `withFills`). A ruled tool met on an agent WITHOUT the layer is refused rather than run unruled (`serve.ts` · `unmountedRulesRefusal`). Inner dispatch (`ctx.tools.call`) refuses a ruled tool unless every ruled argument is given (`toolDispatch.ts` · `refuseUnaccountedRuledArguments`). |
| FOLD | the answer's standing (`assessment/assess.ts` · `readArgumentVerdicts`), this turn's rows only: a `default` row fires `argument-assumed`, a `model` row on a ruled argument fires `argument-unverified` — "not sure". A before-tool middleware that rewrote a ruled argument AFTER the layer checked it supersedes the row (its value is what ran): assumed, unless it declared the value the person's or the app's (`allow(args, why, { from })`; `middleware/outcomes.ts` · `allow`). No row here ever SUPPORTS "known". |
| SERVE | the model: the served schema drops an `assume`-ruled argument from `required` and says the rule (`serve.ts` · `withArgumentRules`); a call that ran on a filled value gets a past-tense note after the tool's own bytes (`serve.ts` · `filledNote`), and its history message carries `toolChars` so the evidence gate never counts the note as the tool's words. The person: the rows, the event, the standing — and, only under `.limitsTravelWithTheAnswer()`, an "Assumed (a tool's rule, not your words)" block in the answer (`serve.ts` · `assumedBlock`). |
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
iteration), both under `arrayMerge: Replace`. The four stage bodies load through `import()`
on first use, so a plain agent's graph never carries them.

## Refused, and what the model reads

| When | The call reads |
|---|---|
| its tool's rules cannot be read at dispatch (a hand-built or provider tool) | `search_logs was not run on that call: its argument rules could not be read (<the assert's reason>).` |
| its tool declares rules and the agent was built without the layer (a provider tool, no `.inputsLayer()`) | `search_logs was not run on that call: it declares argument rules this agent was not built to apply.` — and one warning naming `.inputsLayer()` |

Both land in the argument-refusal shape the validation refusal uses (`error: true`), after
permission, so policy still sees every attempted call.

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
- **A call that pauses and resumes** (a check-in, a tool's own `requestInput`) carries the
  filled value into the pause (`pausedCheckInArgs`, `pausedToolArgs`), but its resumed result
  carries no note: the note is appended by the batch loop only.
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
