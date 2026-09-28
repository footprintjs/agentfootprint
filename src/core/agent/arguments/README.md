**Mixed** — the inputs layer (honesty layer 2): what a tool author declares about each argument, where the model says each value came from, and what the library checks, does, files and says.
Map: `declare.ts` (the declaration and its one assert), `sources.ts` (the model's `_findings.from` and its one reader), `rows.ts` (the `argument` row and its door check), `kept.ts` (an answer a call could not use, kept for its next proposal), `askMarker.ts` (the library's own ask, recognised without loading it).
Walker: `resolve.ts` (the one table), `checks.ts` (the declared-sources checks, V1–V6), `subflow.ts` (the four stages of `sf-inputs`), `dispatch.ts` (ToolCalls' half: the fills, the note, the rewrites' `changedKeys`, the fail-closed refusal, the kept answers), `ask.ts` (the one ask per batch: its fields, its declaration, the answer's binding, the re-ask).
Lens: `serve.ts` (the served schema sentence, the notes on a result, the refusals, the "Assumed" block).

**The law.** No argument runs unaccounted for.

Every value on an argument a tool author ruled is one of: the person's (their words, or their
answer to the library's ask), a tool result's, the app's, or a default the LIBRARY filled and
the answer admits. When none of these holds, it is recorded as the model's own, and the
answer's standing says so.

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
period out, the library fills `2h`, the answer's standing reads "not sure — assumed"),
`examples/features/75-ask-for-missing-arguments.ts` (two calls leave the period out, the
person is asked ONCE, both calls run with the answer, and the standing reads "ask" until it
comes) and `examples/features/77-declared-sources.ts` (the model says the period came from
the person's words, a phrase the author declared checks the quote out and the call runs; a
value the words do not hold is a reading, and the person is asked).

## What happens to one ruled argument (this version)

| The value on the call | `assume` rule | `ask` rule |
|---|---|---|
| missing (`declare.ts` · `isMissing`) | `default`, no `proposed` — the call runs with the declared default FILLED | `asked: 'missing'` — the person is asked, ONCE for the whole batch, before anything in it runs; the answer files `answered` and the call runs with it |
| missing, and this turn KEPT the person's answer for this (tool, argument) (`kept.ts`, below) | — | `answered` — the kept answer is FILLED, nobody is asked again |
| present, the same value as the declared default (`declare.ts` · `sameArgumentValue`) | `default`, `proposed` = the model's — the call runs as sent | — (an `ask` rule has no default) |
| present, any other value | `model` — runs as sent, flagged | `model` — runs as sent, flagged |

A present value equal to the default is filed as `default`, never as the model's choice: a
model that copies a default from a description chose nothing. `proposed` tells the two
`default` rows apart. Without declared sources the model says nothing about its values, so no
present value can be verified as the person's: every present value a default does not match
reads `model` — and an `ask` argument's present value is NOT asked about (adopted Q2): with
nothing to check it against, the ask would fire on nearly every call, including when the
person already said the value. Declared sources (next section) are what change that.

## Declared sources — the model says where each value came from; the library checks it

Two doors arm ONE thing (`core/Agent.ts` resolves them once into `argumentSourcesArmed`):
`.inputsLayer({ argumentSources: true })` — declared sources alone — and
`.findings({ argumentSources: true })` — beside the findings ledger (`.findings()` +
`.inputsLayer({ argumentSources: true })` serves exactly the same bytes). The findings door needs
the inputs layer and is refused at build without it; the inputs-layer door arms the layer
itself. The model declares, per argument, where the value came from — in the reserved
`_findings` argument, planted on RULED tools only: beside the ledger, the ledger's decoration
with `from` FIRST and in its `required`; without it, the reserved argument with `from` alone
(`findings/reserved.ts` · `FINDINGS_SOURCES_SCHEMA`, `withSourcesArgument` — no `basis`, no
`previous`, and nothing on an unruled tool). Every other tool keeps what it had:

```ts
const agent = Agent.create({ provider, model })
  .tool(searchLogs) // window: { ask, choices: [{ value: '7d', said: ['last week'] }, '1h', '24h'] }
  .inputsLayer({ argumentSources: true })
  .build();
// The model calls search_logs({ service: 'checkout', window: '7d',
//   _findings: { from: [{ argument: 'window', source: 'user', quote: 'over the last week' }] } })
agent.findings(); // [{ argument: 'window', source: 'said', matched: 'phrase', claimed: 'user', quote: 'over the last week', … }]
```

**What the model is served — `from` explained ONCE, where it decides.** Under the arm an `ask`
property's sentence names the declaration (`serve.ts` · `ASK_SOURCES_SENTENCE`: "…leave it out
unless the person gave it, and then quote their words for it in `_findings.from`."); `from`'s own
property carries the rest (`findings/reserved.ts` · `FINDINGS_FROM_PROPERTY`: one entry per
value, what each source means, a quote copied exactly, and what the record keeps — "a value with
no entry has no declared source on the record"); and a note on a result whose call ran on the
person's answer adds that a later call may cite that answer as `turn` (`serve.ts` ·
`ANSWERED_SOURCE_CLAUSE` — never for a hidden answer, which the record cannot compare). Both
sentences are served only on a tool whose schema carries `from` — never on one whose author owns
`_findings` (below): the armed layer changes what a present value needs, and a sentence may say
only what the layer will do with the tool it is on. There is
NO system-prompt line: the paid step-5 run (`bench/inputs/runs/haiku45-step5`) served one beside
the property, which paid for the explanation twice, and its first-draft wording ("Optional: …
Leave an argument out rather than guess"; the id pointed at `previous[]`) is why the model wrote
`from` on 35 of 268 calls and cited the person's words only beside a result it cited too.

| `source` in `from` | Needs | Checked against (`checks.ts` · `checkSource`) | Traced as |
|---|---|---|---|
| `user` | `quote` | the quote in the PERSON's own messages (`lib/saidByPerson.ts` · `isSaidByPerson`, the window's), then the value in the quote — or a phrase the author declared for that value's own choice (`said`) | `said` + `matched: 'quote' \| 'phrase'`; the words found but the value not in them is a READING (`said` + `reading`) |
| `result` | `id` | that one result's own bytes, read the way the evidence index reads a result (`evidence/resultCarries.ts` · `resultReader` over `evidence/evidenceIndex.ts` · `readResult`: numbers and booleans in compact JSON are found — also when a framework note follows the JSON, in several MCP text blocks and in a capped result's head (`evidence/servedJson.ts`); this layer's own note is past the tool-bytes boundary) | `result` (+ `setAside` when the model had declared that result `open`, `noise` or `ruled-out`; `argumentsFrom: 'listed' \| 'unlisted'` when the tool declares its grounds) |
| `turn` | — | the person's earlier ANSWERS to the library's ask (the ledger's `answered` rows) of the same argument of the same tool, or of a period — any tool's — in a spelling that converts (`24h` ↔ `-24h`) | `answered` (+ `matched: 'spelling'`, `earlier`) |
| `app` | — | the app's own text: `role: 'system'` messages, the composed system prompt (the library's own instructions left out), and `AgentOptions.externalGrounds` | `app` (+ `appSource`: the ground's label) |
| `assumed` (or no entry) | — | nothing: the model's own | `model` |

A claim is FILED as written and never repaired; a failed check keeps `claimed` and `failed`
(`quote-not-found`, `composed-message`, `unknown-result`, `placed-result`, `not-in-result`,
`no-earlier-turn`, `not-in-earlier-turns`, `only-in-model-answer`, `not-in-app-text`,
`uncheckable`). For a failed claim and for the model's own value the library still looks the
value up — `coincides: 'person' | 'result' | 'app'`, a HINT: never a source, never support,
never enough to skip an ask. A value or quote with no token, or a haystack past the index's
ceiling, is `uncheckable` — never a pass, never "not found". A value equal to the argument's
own `assume` default that did not trace to the PERSON (their words or their answer) is filed
`default`, the claim kept: a default never earns `app` or `result` standing (V1).

What each present value then does — the one table (`resolve.ts` · `verifyPlan`):

| The present value | `assume` rule | `ask` rule | no rule (a `from` entry named it) |
|---|---|---|---|
| traced — `said` (quote or phrase), `answered`, `result`, `app` | runs | runs | runs; a row |
| the declared default, not the person's (V1) | runs → `default` | — | — |
| untraced — nothing declared, `assumed`, a hint only, a failed claim, a READING | runs, flagged | **`asked: 'unverified'`** — the person is asked, in the batch's one ask | runs; a row (a failed claim flags) |

A reading ASKS under an `ask` rule — otherwise any exact fragment of the person's message
would carry any value past the rule — and the ask's field shows the person their own words
(`context.agentfootprint.fields[].quoted`), never the model's value, and never while a tool in
reach can hide arguments (the row's quote reads `'REDACTED'` then too — below). The answer replaces the model's value: the `answered` row carries the
model's value as `proposed`, and the note says so ("… was chosen by the person when asked (the
call had carried "24h"); a later call may cite that answer in `_findings.from` with source
'turn'."). A missing value is resolved as without the arm: it has no source to check.

**Without the ledger, what else changes — and what does not.** ToolCalls peels `_findings` off a
RULED tool's calls only (the only ones it was planted on — `stages/toolCalls.ts` ·
`peelsReserved`, the tools slot's own `carriesRules`), files no basis row, and the choice seam
reads a call's arguments without it wherever the served schema carries it
(`findings/reserved.ts` · `carriesFindingsDecoration`), so a result id or a source word in
`from` is never judged as an argument value. The dropped `from` entries then always ride the
call's first argument row (`honesty/sourceCorpus.ts` · `declaredSourcesOf`'s `basisRows`).
Standings never exist without the ledger, so `setAside` is never filed — it is the ledger's.

**A ruled tool whose author owns `_findings`** (`findings/reserved.ts` · `ownsReservedArgument`)
cannot carry `from` — both planters leave its schema as written. So, under either door:

- **registered** (`.tool()`, a skill's tools — scoped ones too — or an MCP tool registered on
  the builder), it is REFUSED at build, naming the tool (`buildToolRegistry.ts` ·
  `assertReservedArgument`, armed by `argumentSources` over every ruled tool of the dispatch
  map): its `ask` sentence would name `_findings.from`, and the model's declaration would run as
  the author's argument. An UNRULED tool is never decorated by this arm and keeps its own
  `_findings`; without `.findings()`, nothing else arms the refusal.
- **met only at dispatch** (a ToolProvider's, an MCP server's through one), it is served and run
  as written: no sentence it is served names `_findings.from` — its `ask` property carries
  `ASK_SENTENCE` and its answered notes no `turn` clause (`serve.ts` · `rulesOnWire`'s
  per-schema `optionsOf`, from the tools slot; `stages/toolCalls.ts` · `noteOptionsFor`) — its
  calls are not peeled and declare nothing (no `claimed` on its rows), and a present value on its
  `ask` argument is filed `model` and runs, as without the arm.

**A composed message is never the person's.** A composition hands its later steps another
runner's output as their message: `Sequence` (every step after the first), `Loop` (every
iteration after the first), `workflow()` (every step after the first — a string output as
`{ message }` or a structured hand-off, marked whole) and `graph()` (every node that is not a
root, a `join` node included); and — when they were handed a composed message themselves —
`Parallel`, `Conditional`, a nested `Sequence` / `Loop`, `workflow()`'s first step and
`graph()`'s roots pass it on (`AgentInput.messageFrom: 'composed'`, `core/messageFrom.ts` ·
`composedInput`, passed ONLY to a runner that reads it, so every other composition's bytes are
what they were). An armed agent records it (`AgentState.userMessageFrom`), and a quote found
only in that message fails `composed-message`. Code that composes runners by hand passes
`messageFrom: 'composed'` the same way.

**A quote is shown only while no tool in reach can hide arguments.** A quote is free text the
model wrote, token-equal to the person's words: it may hold ANY value the person gave, in any
spelling — a user name and a password in one sentence, a PIN typed "1 2 3 4" and passed as
`1234` — and a tool's argument view covers only that tool's own arguments. So every row's
`quote` reads `'REDACTED'`, and no ask carries `quoted`, on an agent that:

- registers a tool carrying an argument view (`core/toolShownArgs.ts` · `carriesArgumentView`:
  `flowchartAsTool({ redact })`, `runbookAsTool({ redact })`) — through `.tool()`, a skill's
  tools, or an MCP tool registered on the builder; or
- wires a ToolProvider — `.toolProvider()`, or `.selfExplain()`, which serves its trace tools
  through one — whatever it lists. A provider's list is known only per iteration, and a tool it
  lists (or is first called) AFTER a quote was filed would find that quote already on the
  record, so any provider counts, even one that never lists a hiding tool.

The agent decides it ONCE, at build (`core/Agent.ts` · `buildChart`, the inputs layer's
`sources` → `SourcesArm.argumentViews`), over every party the layer's `toolOf` can resolve (the
registry and the provider — `stages/toolResolver.ts` · `buildToolResolver`), so no ordering
leaks a quote: filed before the hiding call, in an earlier iteration or turn, or before a
provider first lists the tool (`resolve.ts` · `quotesMayShow`). On an agent with neither, a
quote is shown as the model wrote it (clipped, `rows.ts` · `QUOTE_CHARS`) — except beside a call
whose name nothing answers, which has no view to ask. The checks still read every quote in
memory; only what the record SHOWS changes.

## The batch ask — once, before anything runs

The layer names, per call, the `ask` arguments the call left out — and, under declared
sources, the ones whose present value did not trace to a source (`resolve.ts` ·
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
| DECLARE | the tool author: `Tool.askOrAssume` (`{ assume }` or `{ ask, choices? }`) and `Tool.period` (`ToolPeriod`), judged by ONE assert (`declare.ts` · `assertAskOrAssume`) at definition (`core/tools.ts` · `defineTool`), at dispatch (`declare.ts` · `rulesOf` — a Tool built by hand or served by a ToolProvider never passed `defineTool`) and at MCP ingest (`lib/mcp/toolExtras.ts` · `readToolExtras`, which judges each rule against the listed tool's own `inputSchema`). A rule is refused, never repaired: an argument the schema does not offer or whose type is not exactly one of `string`, `number`, `integer`, `boolean`; a `wants` argument; a value or choice the PROPERTY's own schema rejects (never the root `required`); a period on an argument with no rule. The host declares its own ask context (`AgentOptions.argumentAskContext`). The MODEL declares, under declared sources (`.inputsLayer({ argumentSources: true })` or `.findings({ argumentSources: true })`), where each value came from (`_findings.from`), read by the ONE reader of `_findings` (`findings/reserved.ts` · `readDeclaration`, through `sources.ts` · `readSources`): a malformed entry is dropped and counted, never defaulted. A composition declares a message it composed (`AgentInput.messageFrom`). |
| VERIFY | `resolve.ts` · `verifyPlan` — the tables above; a pure function of the batch and the rules of the implementation that will run (`stages/toolResolver.ts` · `buildToolResolver`, the one dispatch resolver). The declared sources: `checks.ts` · `checkSource`, whole-token membership in the ONE place each source lives, over corpora the mount builds from the served record (`honesty/sourceCorpus.ts` · `sourceCorpusOf`) — a membership pass can REFUTE a claim and never supports one. The person's answer: `ask.ts` · `checkAnswer`, the property's own schema. |
| RECORD | `rows.ts` · `ArgumentRow` — one row per ruled argument per call, its value in the tool's OWN argument view (`core/toolShownArgs.ts` · `shownArgsOf`: a hidden argument reads `'REDACTED'`), stamped with the conversation `turn`: `default`, `model`, `asked` (`missing`, `invalid-answer`; no value), `answered` (`free` for a free-text field; filed by the layer itself, with no `asked` row, when a kept answer fills the value). Under declared sources a present value's row also carries the check (`claimed`, `matched`, `quote` — `'REDACTED'` while any tool in reach can hide arguments (a registered tool with an argument view, or any ToolProvider), since a quote is free text that may hold any hidden value (`resolve.ts` · `quotesMayShow`) — `reading`, `earlier`, `result`, `setAside`, `argumentsFrom`, `appSource`, `coincides`, `failed`), the model's value as `proposed` on an `asked: 'unverified'` row, a FREE argument a `from` entry named is filed with no `rule`, and the call's first row carries its dropped `from` entries (`malformed`) when no basis row does. The layer's rows are merged into the ONE ledger (`AgentState.findingsLedger`) by the ledger's pure half (`findings/ledger.ts` · `appendRows`) in ONE write per batch, through the mount's output mapper (`honesty/mounts.ts` · `mountInputsLayer`); the ask's `answered` and `invalid-answer` rows through the one writer (`findings/ledger.ts` · `recordFindings`), once per answer. One `agentfootprint.findings.argument` event per row (names, enums and counts — never a value). The `agentfootprint.pause.resume` event of the library's own ask carries the reply's shape with every value `'REDACTED'` (`askMarker.ts` · `argumentAskReplyForEvent`, read in `core/RunnerBase.ts` · `emitPauseResume`), because an answer may fill an argument the tool's view hides. |
| RESOLVE | **assume** (fill the declared default — `resolve.ts` · `resolutionsOf`), **ask** (the batch ask, `stages/argumentAsk.ts` · `askBeforeDispatch` — a missing `ask` value, and under declared sources an untraced present one), **refuse** (rules that cannot be read at dispatch; answers that never fit). ToolCalls applies each entry after `tool_start` (which keeps the model's proposal) and BEFORE the permission check, so policy judges the call that will really run (`dispatch.ts` · `withFills`). A ruled tool met on an agent WITHOUT the layer is refused rather than run unruled (`dispatch.ts` · `unmountedRefusal`, the sentence `serve.ts` · `unmountedRulesRefusal`). The refusals are decided after permission and BEFORE the before-tool middleware chain, so no middleware can ask a person about a call that will not run; the middleware-ask resume door re-applies them (`stages/toolCalls.ts` · `resume`). Inner dispatch (`ctx.tools.call`) refuses a ruled tool unless every ruled argument is given (`toolDispatch.ts` · `refuseUnaccountedRuledArguments`). |
| FOLD | the answer's standing (`assessment/assess.ts` · `readArgumentVerdicts`, `readArgumentAsk`), this turn's rows only: a `default` row fires `argument-assumed`, a `model` row on a ruled argument fires `argument-unverified` — "not sure"; the batch ask still waiting (`AgentState.argumentAsk`'s `waiting`, with this turn's `asked` rows as witnesses) fires `argument-asked` — "ask". Under declared sources: a READING fires `argument-read`, a value from a result the model had set aside fires `value-contingent`, a failed claim on ANY argument fires `argument-unverified`, and a traced source (`said` via the quote or a phrase, `answered`, `result`, `app`) fires nothing — so an answer can read "consistent with the record" on checked values, and never "known" from them; `checked` gains `argument-sources`. An `answered` row fires nothing and supports nothing. A before-tool middleware that rewrote a ruled argument AFTER the layer checked it supersedes the row: assumed, unless it declared the value the person's or the app's (`allow(args, why, { from })`; `middleware/outcomes.ts` · `allow`), read by ONE owner (`middleware/rewrites.ts` · `argumentRewritesOf`). Every result the fold reads is the TOOL's own bytes (`lib/toolBytes.ts` · `toolBytesOf`). No row here ever SUPPORTS "known". |
| SERVE | the model: the served schema drops a ruled argument from `required` and says the rule (`serve.ts` · `withArgumentRules`, `ASK_SENTENCE`); a call that ran on a filled value gets a past-tense note after the tool's own bytes (`serve.ts` · `filledNote`) — one clause per fill the call really ran with (`dispatch.ts` · `fillsThatRan`) — and its history message carries `toolChars`, the cut every reader of a result as the TOOL's words reads through (`lib/toolBytes.ts` · `toolBytesOf`). Under declared sources: the `from` property on a ruled tool's `_findings` (`findings/reserved.ts` · `FINDINGS_FROM_PROPERTY`, first and required — or alone, `FINDINGS_SOURCES_SCHEMA`, without the ledger), the `ask` sentence that names it (`serve.ts` · `ASK_SOURCES_SENTENCE` — only where the schema carries it, never on a tool whose author owns `_findings`), and the answered note's "(the call had carried …)" and its `turn` clause (`serve.ts` · `ANSWERED_SOURCE_CLAUSE`) — no instruction line. The person: the typed ask (with `quoted`, the person's own words a reading was made of); the rows, the event, the standing — and, only under `.limitsTravelWithTheAnswer()`, an "Assumed (a tool's rule, not your words)" block (`serve.ts` · `assumedBlockOf`). The evidence gate treats a declared default as the app's words and an answered value as the person's (`evidence/evidenceIndex.ts` · `exemptFromRun`, `stages/route.ts` · `answeredValuesOf`). |
| ARM + MEASURE | a REGISTERED tool that declares rules (`.tool()`, a skill's tools, an MCP tool registered on the builder) arms the mount; `AgentBuilder.inputsLayer()` arms it for ruled tools only a ToolProvider serves. Nothing declared → nothing mounted, decorated, read or written: every run is byte-identical (the 21 references in `test/core/tools/reference/`), and an agent whose tools declare only `assume` rules is byte-identical to step 3 (its two references). The ask's code loads through `import()` when an ask is raised. The bench is honesty step 2's inputs bench, whose registered rule names step 4's clauses (the share of period calls that ran with the value the person meant, the needless asks on the controls, the facts, the overhead). Declared sources: `.inputsLayer({ argumentSources: true })` alone, or `.findings({ argumentSources: true })` beside the ledger (refused at build without the layer); off → no `from`, no check, no new key — the 25 other references do not move, `agent-arguments-sources` pins the armed run beside the ledger and `agent-arguments-sources-only` without it; step 5 is measured by its own rule, registered before its first paid call. |

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

## What a plain agent carries

The optional-family law of docs-next's site budget (`docs-next/scripts/check-site-budget.mjs`):
the layer's run-time code reaches a run through `import()` at the point the arm is known, so
a plain agent's graph never carries it.

| Loaded through `import()`, only when armed | Loaded by |
|---|---|
| `subflow.ts`, `resolve.ts` — the four stage bodies and their pure steps | the mount's stage wrappers (`honesty/mounts.ts`), on first use |
| `dispatch.ts` — the fills, the note, the rewrites' `changedKeys`, the fail-closed refusal, the kept answers (`kept.ts`) and the one-question refusal | ToolCalls, once per batch under the arm; for a ruled tool on an agent without the layer, at that call |
| `ask.ts`, `stages/argumentAsk.ts` — the one ask per batch | ToolCalls, when an entry of the batch names an ask |
| `serve.ts` — the served schema, the note and refusal sentences, the "Assumed" block | the tools slot and seed (the schema), `dispatch.ts`, the final branch's armed variant (`stages/prepareFinal.ts` · `prepareFinalWithLimitsAndAssumedStage`) |
| `middleware/rewrites.ts` — the one reading of a rewrite | `serve.ts` and the standing fold (`assessment/assess.ts`, itself loaded on first use) |
| `checks.ts` — the declared-sources checks (V1–V6) | `resolve.ts`, under declared sources only (`.findings({ argumentSources: true })` or `.inputsLayer({ argumentSources: true })`) |
| `honesty/sourceCorpus.ts` — the corpora the checks read | the mount's closure (`honesty/mounts.ts` · `buildInputsSubflow`), on the first armed batch |

What stays on the default graph is what a SYNCHRONOUS door needs before anything is known to
be armed: the declaration and its one assert (`declare.ts` — `defineTool` refuses a malformed
declaration synchronously, at definition), the row's shape and its checkpoint check
(`rows.ts`, run by `validateCheckpoint`), the mount and the arm itself (`honesty/`,
`AgentBuilder.inputsLayer`, the charts), the turn stamp and the one-writer merge
(`findings/ledger.ts`), the tool-bytes cut (`lib/toolBytes.ts`) and
`allow(args, why, { from })`. Declared sources add two small static pieces: the reader of
`from` (`sources.ts` · `readSources`, because the one reader of `_findings` is synchronous and
on every armed agent's graph) and the composed-message marker (`core/messageFrom.ts`, which the
compositions call) — the checks and the corpora load with the layer. Two small armed pieces stay static on purpose: the argument
row's event (`findings/ledger.ts` · `emitArgumentRow`, inside the one writer's emit half) and
the inner-dispatch refusal (`toolDispatch.ts` · `refuseUnaccountedRuledArguments`, which
refuses before `ctx.tools.call` takes its sequence number — an `await` there would reorder
concurrent inner calls). `test/lib/trace-toolpack/browserGraph.test.ts` pins the split.

## The period argument, and the results layer (honesty step 7b)

`Tool.period` (`declare.ts` · `ToolPeriod`) is this layer's declaration — which
argument sets the period, in which declared spelling — and it now ALSO arms the
results layer (`core/agent/results/README.md`): a tool that declares a period
argument owes a period on its results, so each call gets a `period` row at the
loop head — the period's verdict, or `undeclared` when the result said nothing
about what its read covered. The two rows join by the call id and the argument
name (the `argument` row's `period: true`, the `period` row's `argument`): this
layer says WHO chose the period, the results layer says WHAT the read covered,
and neither parses the other's words. The answer's standing names both rows as
the witnesses of a `period-*` reason. This layer's rows, served bytes and refusals
are unchanged.

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

- **The ask inside `sf-inputs`, as the design drew it (follow-up).** The batch ask is raised
  by ToolCalls (`stages/argumentAsk.ts`) because footprintjs could not resume a pause inside
  a subflow of the loop body, nor a decider looping back to the paused stage. footprintjs
  9.28.0 fixed both (`test/core/agent/arguments/ask-placement.test.ts` pins the healthy
  traces — facts 1 and 2), so the ask MAY now move into `sf-inputs` with a `Bind` decider
  that loops back to it, and a second pause in the batch that asked need no longer be
  refused. Not moved yet: the move changes the chart, the record and the refusal above, and
  is its own packet.
- **Asking about a PRESENT value without declared sources** — a value on an `ask` argument
  the model did send runs as sent, filed `model`, unless declared sources are armed
  (`.inputsLayer({ argumentSources: true })` or `.findings({ argumentSources: true })`): only a
  value the model can declare a source for can be checked, so only then is an untraced value
  asked about.
- **What a quote MEANS.** Membership cannot see a negation ("not the last 24 hours — the whole
  week" quoted as "the last 24 hours" passes), another sentence, or a one-token quote taken from
  another sense ("the 24h dashboard" quoted as "24h"). That is why no membership pass ever
  supports "known" — it only keeps a reason from firing — and why the bench counts one-token
  quotes. The library never parses a time phrase: only phrases an author declared (`said` on a
  choice) are matched, as whole tokens, inside a quote the model declared.
- **Unicode folding.** A character outside the token alphabet (full-width `２４ｈ`) vanishes on
  both sides; a value or quote left with no token is `uncheckable`. Folding, if wanted, belongs
  in `evidence/normalize.ts` for the evidence gate and this layer together.
- **Words the window evicted**, and a compaction frame (never the person's words): the checks
  read the SERVED window, like the evidence index. The person's answers survive on the ledger.
- **A result that echoes the argument it was called with** (other than an absence's
  `looked_for`) carries the value, as it does for the evidence gate. The echo is not detected:
  a value the model guessed, passed to a tool that echoes its arguments, and then cited from
  that result for an `ask` argument verifies as `result` and runs unasked. When the echoing
  tool is RULED, its own call has rows and the guess shows there; an UNRULED tool files no
  rows, so the record shows only the `result` claim (named, not fixed: the fix reads the cited
  call's own arguments). A result known only through the previous batch — the window no longer
  serves it — has no tool-bytes cut to read through: a claim on it is `uncheckable`.
- **An answer the tool's view hides** cannot be compared with a later value: a `turn` claim
  against it is `uncheckable` (the row holds the placeholder, never the raw value).
- **A `turn` claim resolves to an earlier ANSWER only** (to the library's ask) — of the same
  argument of the same tool (another tool's `limit` is not this one's), or of a period, any
  tool's, in a spelling that converts. A value the person TYPED in an earlier
  turn is a `user` source with its quote (quotes are checked across every person message still
  in the window); a value only the library finds in earlier words, results or the app's text is
  a hint.
- **A call whose every `from` entry is malformed, with no basis and no ruled argument** files
  no row, so its dropped-entry count has nowhere to ride.
- **The other compositions.** A pattern that hands your runners another runner's output does
  so through `Sequence`, `Loop`, `Parallel` or `Conditional` (`swarm()`, `llmSwarm()`) and
  inherits the mark. `reflection()` is built from `LLMCall`s, so its critic cannot call a ruled
  tool at all.
- **The mark is the RUN's, not the message's.** `userMessageFrom` is a run constant: a
  `followUp` (or `continueFrom`) after a composed run reads the earlier composed message as the
  person's (`earlier`), and a composed message that a conversation carries in from another run
  is not marked. And the top-level `run()` of `Sequence`, `Loop`, `Parallel` and
  `Conditional` passes only `{ message }` on: to mark a composed message by hand, hand it to
  the `Agent` (or to `workflow()` / `graph()`, which pass their whole input on) as
  `messageFrom: 'composed'`. Marking each message is named, not built.
- **Library suffixes on messages this layer did not annotate** (a step banner, an effect note,
  the repeated-call note) are read as they always were (adopted Q16), as text; they carry names
  and counts, never argument values — but a count can match a small number. What comes BEFORE
  them is the tool's JSON, and it is read by the JSON grammar (`evidence/servedJson.ts`, through
  `evidenceIndex.ts` · `readResult` — the evidence gate reads it the same way): read whole as
  text, `{"id":4417}` would tokenise to `:4417`, and a number the tool returned would read as
  absent — a false `not-in-result`, then a needless ask.
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
- **Open for the owner — an `app` claim under an `ask` rule.** A value found in the app's own
  text (the system messages, the composed system prompt, `externalGrounds`) is traced
  (`checks.ts` · `isTraced`), so under an `ask` rule it runs unasked, as the person's quoted
  words do. Whether an `ask` rule should accept only the PERSON (`said`, `answered`) and ask
  about an `app` value is the owner's call; the code keeps `app` traced until then.
- **Open for the owner — the default output-schema instruction as the app's text.**
  `.outputSchema()` adds an always-on instruction (`core/outputSchema.ts` ·
  `buildDefaultInstruction` — the library's sentence, plus the parser's own `description` —
  unless the app passes its own `instruction`), and only the findings and ontology instructions
  are left out of the app corpus (`honesty/sourceCorpus.ts` · `LIBRARY_INSTRUCTIONS`). So a
  value that text spells checks out as `app`. Whether the library's default sentence counts as
  the app's text is the owner's call; the corpus is unchanged until then.

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

Under declared sources, from the same rows: the **declared-source rate** (rows whose
`claimed` is not `none`), the **verified rate** — how often the model's quotes, ids and
earlier answers checked out, a COPYING measure, not an honesty measure (traced sources over
declared ones), the **failed-claim mix** (the `failed` values — `quote-not-found`,
`not-in-result`, `composed-message`, …), the **reading rate** (`said` + `reading`: values
read into the person's words), the **hint rate** (`coincides`; split it at
`integrity/argumentLeaves.ts` · `MIN_CHECKED_LENGTH`, four characters — a short value
coincides by chance), the **contingent uses** (`setAside`: values taken from a result the
model had set aside), the **composed-run exposure** (`failed: 'composed-message'`), the
**unverified-ask rate** (`asked: 'unverified'`) and — from the request receipts — the
**tokens per call** the `from` property costs
(`test/core/agent/arguments/sources-layer.test.ts` and `sources-served.test.ts` print the served
characters: on 2026-09-28, beside the ledger, the ruled tool's schema +744 characters, the system
prompt +0, an unruled tool +0 — the first cut was +617 and +447; without the ledger, the ruled
tool +863 over a plain agent's, where the ledger alone costs every tool about +2,400).
