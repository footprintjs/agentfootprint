[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentBuilder

# Class: AgentBuilder

Defined in: [src/core/agent/AgentBuilder.ts:179](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L179)

Fluent builder. `tool()` accepts any Tool<TArgs, TResult> and registers
it by its schema.name. Duplicate names throw at build time.

## Constructors

### Constructor

> **new AgentBuilder**(`opts`): `AgentBuilder`

Defined in: [src/core/agent/AgentBuilder.ts:409](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L409)

#### Parameters

##### opts

[`AgentOptions`](/agentfootprint/api/generated/interfaces/AgentOptions.md)

#### Returns

`AgentBuilder`

## Methods

### act()

> **act**(`options`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:751](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L751)

Everything this agent DOES about its own loop, in one block.

Tools do the work. `.act()` decides about the work. `watch` remembers
both — and nothing can act without being watched.

Five keys, one per moment of a turn, each optional and each the exact
argument the individual door takes:

```ts
const agent = Agent.create({ provider, model })
  .act({
    input:      [scrubSSNs],        // the message, before the run commits it
    beforeTool: [refundCeiling],    // every call, before it is dispatched
    afterTool:  [hideRawPII],       // every result, before the model reads it
    window:     slidingWindow({ keepRecentTurns: 12 }),
    output:     [noInternalCodenames],
  })
  .build();
```

**It is sugar, and provably so.** Each key is forwarded to the door that
already owned it — `.messageMiddleware()`, `.toolMiddleware()`,
`.window()` — so the agent it builds sends the same request bytes and
files the same records as the same rules spelled out one call at a time.
That equivalence is pinned per key by tests, the way `.compaction()`'s is.

**The keys cannot fall behind the loop.** They are locked at compile time
against `LoopMoment`, so a sixth moment cannot ship without a key here.

**A rule speaks where its hooks say, not where you filed it.** `beforeTool`
and `afterTool` are one chain; an entry with both `onToolCall` and
`onToolResult` runs at both moments whichever key you wrote it under —
the KEYS are named for the moments, the HOOKS for what they receive — and
an entry named
under both keys is the same object attached once. A governance rule that
silently did not run because it was written in the wrong bucket is exactly
the failure this library exists to make impossible — so the bucket is
checked for the hook it names, and the hooks decide the rest.

**Call it once.** A second `.act()` throws: two posture blocks means the
answer to "what does this agent do at each moment?" is in two places, and
the second one silently wins. Adding one piece to an agent somebody else
built — a plugin, a policy pack — is what the individual doors are for,
and they stay open for exactly that.

#### Parameters

##### options

[`ActOptions`](/agentfootprint/api/generated/interfaces/ActOptions.md)

One key per moment. `input` / `output` take message
  middleware, `beforeTool` / `afterTool` take tool middleware, `window`
  takes a `WindowStrategy`. Unknown keys throw.

#### Returns

`this`

***

### appName()

> **appName**(`name`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1074](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1074)

Set the agent's display name — substituted as `{{appName}}` in
commentary + thinking templates. Same place to brand a tenant
("Acme Bot"), distinguish multi-agent roles ("Triage" vs
"Reviewer"), or localize ("Asistente"). Default: `'Chatbot'`.

#### Parameters

##### name

`string`

#### Returns

`this`

***

### build()

> **build**(): [`Agent`](/agentfootprint/api/generated/classes/Agent.md)

Defined in: [src/core/agent/AgentBuilder.ts:2464](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2464)

#### Returns

[`Agent`](/agentfootprint/api/generated/classes/Agent.md)

***

### checkIn()

> **checkIn**(`opts?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:2324](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2324)

#### Parameters

##### opts?

[`CheckInBuilderOptions`](/agentfootprint/api/generated/interfaces/CheckInBuilderOptions.md) = `{}`

#### Returns

`this`

***

### commentaryTemplates()

> **commentaryTemplates**(`templates`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1089](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1089)

Override agentfootprint's bundled commentary templates. Spread on
top of `defaultCommentaryTemplates`; missing keys fall back. Same
`Record<string, string>` shape with `{{vars}}` substitution as
the bundled defaults — see `defaultCommentaryTemplates` for the
full key list.

Use cases: i18n (`'agent.turn_start': 'El usuario...'`), brand
voice ("You: {{userPrompt}}"), per-tenant customization.

#### Parameters

##### templates

`Readonly`\<`Record`\<`string`, `string`\>\>

#### Returns

`this`

***

### compaction()

> **compaction**(`options`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:934](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L934)

Keep the live context window inside a token budget — without ever losing
the record.

Sugar for `.window(summarizeOldest(options))`, and byte-for-byte the same
agent. It keeps its own name because compaction is what the market calls
this and it is the strategy most people want first.

At each ReAct iteration boundary, compaction compares the LAST call's
**adapter-reported** input tokens against `thresholdTokens`. Over budget,
it folds the oldest foldable span of the conversation into one summary
message and sends that instead. Counted, never guessed: a provider that
reports no usage gets a named refusal
(`CompactionUnmeasurableError`) rather than an invented number.

**The fold edits the window, not the record.** The turns it folds stay in
the run's commit log byte-identical — footprintjs's log is append-only,
so a fold cannot erase them even in principle. The summary enters as its
own recorded step naming every `runtimeStageId` it folded, plus what was
measured and what refused to fold. A compacted run is still a provable
run: the lens draws a fold seam, not a hole.

Never folded: the system envelope, the last `keepRecentTurns` turns, and
any turn holding something unresolved — an unanswered tool call, a paused
tool, a pending check-in. Folding an unanswered question would destroy
the referent of the answer that has not arrived yet, so those refuse by
name and the fold takes the next oldest instead.

Omit `.compaction()` and nothing changes: no stage, no extra keys, the
same request bytes as before.

#### Parameters

##### options

[`CompactionOptions`](/agentfootprint/api/generated/interfaces/CompactionOptions.md)

#### Returns

`this`

#### Example

```ts
const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .compaction({
    thresholdTokens: 120_000,
    summarizer: anthropic(),
    model: 'claude-haiku-4-5',   // the cheap one writes the summary
  })
  .build();
```

***

### configure()

> **configure**(`fn`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:684](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L684)

Decide this run's model and/or system prompt when the run starts.

An agent is built once and run many times, but not every run wants the
same model or the same instructions: a long message may deserve the
bigger model, a tenant may have its own house rules, a canary may want
last week's prompt. Rebuilding the whole agent per request works and is
wasteful; reaching in and mutating one is worse, because the trace then
describes an agent that no longer exists.

The resolver runs ONCE per `run()`, at the start of the run, and what it
returns is **committed to the trace** — `resolvedModel` and
`resolvedInstructions` land in the run's commit log before the first LLM
call, and the LLM call reads them from there. So the recording says which
model actually answered instead of which model the agent was built with.

Return `{}` (or nothing) to keep the defaults; `ctx.defaults` carries
them, so a resolver can decide relative to what was built rather than
restating it. Omit `.configure()` entirely and every run behaves — and
records — exactly as it did before.

This is the RUN axis only. Tools are the iteration axis and already have
an owner: `.toolProvider()`, consulted every iteration.

Throws if called more than once (same rule as `.toolProvider()` — a
silently-overridden resolver is a config that lies).

#### Parameters

##### fn

`RunConfigFn`

#### Returns

`this`

#### Examples

```ts
Bigger model for a bigger question
  const agent = Agent.create({ provider, model: 'small-model' })
    .system('You answer support questions.')
    .configure(({ message, defaults }) =>
      message.length > 500 ? { model: 'big-model' } : {},
    )
    .build();
```

```ts
Per-tenant house rules
  const agent = Agent.create({ provider, model })
    .system('You answer support questions.')
    .configure(({ identity, defaults }) => ({
      instructions: `${defaults.instructions}\n\n${rulesFor(identity?.tenant)}`,
    }))
    .build();
```

***

### fact()

> **fact**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1509](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1509)

Register a Fact — developer-supplied data the LLM should see.
User profile, env info, computed summary, current time, …
Distinct from Skills (LLM-activated guidance) and Steering
(always-on rules) in INTENT — the engine treats them all alike.

#### Parameters

##### injection

`Injection`

#### Returns

`this`

***

### injection()

> **injection**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1127](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1127)

Register any `Injection`. Use this for power-user / custom flavors;
for built-in flavors use the typed sugar (`.skill`, `.steering`,
`.instruction`, `.fact`).

An Injection carrying `inject.messages` is ROUTED here, not refused
(7.19.1 refused it; 7.21.0 delivers it). What still gets refused is the
pair the wire cannot take: a `role: 'tool'` message has no tool call to
answer, so it is rejected here, at the declaration, on every provider.
A role the ATTACHED provider cannot carry is a different question — it
depends on the provider, which this builder does not have — so it is
refused at run start instead, by name. This is the one funnel every
flavor passes through, so a hand-built Injection cannot go around the
checks the named factories make.

#### Parameters

##### injection

`Injection`

#### Returns

`this`

***

### instruction()

> **instruction**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1487](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1487)

Register an Instruction — rule-based system-prompt guidance.
Predicate runs each iteration. Use for context-dependent rules
including the "Dynamic ReAct" `on-tool-return` pattern.

#### Parameters

##### injection

`Injection`

#### Returns

`this`

***

### instructions()

> **instructions**(`injections`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1498](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1498)

Bulk-register many instructions at once. Convenience for consumer
code that organizes its instruction set in a flat array (`const
instructions = [outputFormat, dataRouting, ...]`). Each element
is registered via `.instruction()` so duplicate-id checks still
fire per-entry.

#### Parameters

##### injections

readonly `Injection`[]

#### Returns

`this`

***

### limitsTravelWithTheAnswer()

> **limitsTravelWithTheAnswer**(): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1741](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1741)

Make the limits of an answer travel WITH the answer (this release).

A tool that returns `coverage(verdict, { checked, notChecked,
cannotCover })` — or `absent({ what, checked, … })` — declares the ground
its result stands on. With this on, the run's declarations are folded into
one block and appended to the final answer, so a reader learns whether
*"everything looks fine"* means **verified** or **unexamined**.

## Why appended, and not asked for

A limit the model is asked to carry is a limit the model can drop, and
dropping it is invisible: an answer with no caveat and an answer whose
caveat was omitted read identically. The block is therefore composed by
the framework from what the tools declared and concatenated onto the
answer — the model does not write it, so the model cannot drop it. The
price is that it changes the bytes of the answer, which is why it is off
by default.

**What it is not.** It does not judge whether the model stated the limits
in its own prose, and it does not refuse an answer that did not. Both
would need a second model to decide what counts as "stated", which is the
one thing this library will not put in a guard (see
`.namesAndNumbersFromEvidence()` and `core/agent/evidence/README.md`).

Off → byte-identical: nothing is appended and the final branch mounts the
stage function it has always mounted. The RECORDING half runs either way
(`agentfootprint.tools.coverage_declared` / `.absent`, and
`coverageDeclared` in the snapshot), so you can measure how often your
tools declare limits before you decide to ship them.

#### Returns

`this`

#### Example

```ts
const agent = Agent.create({ provider, model })
    .tool(replicationHealth)   // returns coverage(verdict, { … })
    .limitsTravelWithTheAnswer()
    .build();
```

***

### maps()

> **maps**(`options?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1454](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1454)

Mount the maps kernel (9.58.0) — the layer that owns ENGAGEMENT, the
axis orthogonal to every map's own cursor.

A mounted map (today: the skill map; the screen map is the next tenant)
keeps sole ownership of its position. What the kernel owns is whether
that map's contributions — prompt fragment and tools — ride the next
call. An engagement founded on a GUESS (an entry regex, a classifier)
is renewed only by concrete evidence: the map's own tool called, a
declared route fired, the model asking by name. Without corroboration
for `renewalGrace` consecutive passes the map is PARKED — its cursor
stays exactly where the map put it, its contribution stops riding, and
explicit or structural evidence re-engages it (an accepted `read_skill`
pick is the recovery door). Every standing change is a typed event:
`agentfootprint.map.engaged` / `agentfootprint.map.parked`.

Why: in a recorded 30-call turn, an entry regex matched the word "zone"
inside "find the most recent zone redundancy run" — a noun the person
wanted to FIND, not a task. The turn stood on an audit skill for all 30
calls; its 4 tools were never called; ~7k characters of the wrong map
rode every call of a 359k-token turn. Under the kernel that map parks
on call four.

Requires a mounted skill map — refused at build() otherwise. Zero-delta
when absent: no scope key, no events, byte-identical evaluation.

#### Parameters

##### options?

`MapsOptions` = `{}`

#### Returns

`this`

#### Example

```ts
const agent = Agent.create({ provider, model })
    .skillGraph(myMap)
    .maps({ renewalGrace: 3 })
    .build();
```

***

### maxIterations()

> **maxIterations**(`n`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1004](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1004)

Override the ReAct iteration cap set via `Agent.create({
maxIterations })`. Convenience for builder-style code that prefers
fluent setters over constructor opts. Last call wins.

Throws if `n` is not a positive integer or exceeds the hard cap
(`clampIterations`'s upper bound).

#### Parameters

##### n

`number`

#### Returns

`this`

***

### memory()

> **memory**(`definition`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1536](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1536)

Register a Memory subsystem — load/persist conversation context,
facts, narrative beats, or causal snapshots across runs.

The `MemoryDefinition` is produced by `defineMemory({ type, strategy,
store })`. Multiple memories layer cleanly via per-id scope keys
(`memoryInjection_${id}`):

```ts
Agent.create({ provider })
  .memory(defineMemory({ id: 'short', type: MEMORY_TYPES.EPISODIC,
                         strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
                         store }))
  .memory(defineMemory({ id: 'facts', type: MEMORY_TYPES.SEMANTIC,
                         strategy: { kind: MEMORY_STRATEGIES.EXTRACT,
                                     extractor: 'pattern' }, store }))
  .build();
```

The READ subflow runs at the configured `timing` (default
`MEMORY_TIMING.TURN_START`) and writes its formatted output to the
`memoryInjection_${id}` scope key for the slot subflows to consume.

#### Parameters

##### definition

`MemoryDefinition`

#### Returns

`this`

***

### messageMiddleware()

> **messageMiddleware**(...`middleware`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:2300](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2300)

Wrap the message boundary in a governance chain — the input before the
model sees it, the output before the caller receives it.

Same verbs as [toolMiddleware](/agentfootprint/api/generated/classes/AgentBuilder.md#toolmiddleware) minus one: there is no `ask` here,
and the type says so. Tool dispatch runs inside a pausable stage, so it
has a checkpoint to suspend on; the message boundary is a plain stage, and
inventing a second pause to give it one would be a worse answer than not
offering it.

The `'input'` half runs at the very top of the run, BEFORE the message is
committed. That placement is the point: everything downstream reads
`scope.history` — the window strategies, the injections, all three slots,
the bytes on the wire and every slice taken afterwards — so the
transformed text is what the whole run agrees was said. The `'output'`
half runs where the final answer is captured, so the record and the caller
receive the same string.

`deny(reason)` at either phase raises a `MessageDeniedError` rather than
returning. At `'input'` there is no model to tell; at `'output'` the
middleware has just refused to release an answer, and handing the caller a
string in its place is the one substitution they must never make without
noticing. The error carries the reason, the phase and the middleware's
name — never the refused content.

#### Parameters

##### middleware

...readonly [`MessageMiddleware`](/agentfootprint/api/generated/interfaces/MessageMiddleware.md)[]

#### Returns

`this`

#### Example

```ts
import { Agent, allow } from 'agentfootprint';

const agent = Agent.create({ provider, model })
  .messageMiddleware({
    name: 'mask-card-numbers',
    onMessage: (msg) => {
      const clean = msg.content.replace(/\b(?:\d[ -]?){13,16}\b/g, '[card]');
      return clean === msg.content ? allow() : allow(clean, 'masked a card number');
    },
  })
  .build();
```

***

### namesAndNumbersFromEvidence()

> **namesAndNumbersFromEvidence**(`opts?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1691](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1691)

Require every **name and number in the final answer** to appear in a tool
result the run actually read (9.35.0). If one does not, the model typed it
rather than read it.

## What it is — and what it provably is not

It is a **fabrication detector, not a correctness judge.** It catches
invented values. It CANNOT catch a false claim assembled from real values:
*"fc1/3 is healthy"* when the data says the port is down uses entirely
grounded tokens, and this check passes it without a murmur. Anyone who
reads it as a hallucination check will trust it for the one thing it
cannot do. It is also conservative by design (small numbers, all-letters
names and units are not examined), because a false accusation costs a real
turn and can refuse a good answer.

The check is **deterministic** — set membership over normalized tokens. No
second model, no embedding, no judge. A guard that needed a bigger model
to police a smaller one would invert this library's whole thesis and would
fail exactly where the small model is deployed.

## The three postures

Same three words as `.skillGraph({ strictness })`, deliberately — and a
SEPARATE setting, because routing authority and evidence discipline are
different decisions:

  • `'assist'` (**default**) — record and flag. The answer goes out
    unchanged; you learn how often it happens before you act on it.
  • `'guard'` — the unsupported values are named back to the model, which
    gets ONE more ordinary turn (tools still on the wire, so it can go and
    fetch what it guessed). Survivors ship flagged. **This is the
    recommended posture for a weaker model.**
  • `'rails'` — the same one revision, then `run()` raises
    `UnsupportedValuesError` rather than return an answer that still
    carries them.

Values the USER supplied — this turn's message, the conversation, the
system prompt and skill bodies — are exempt without being declared: the
user gave them, so they were not invented.

Every judgement lands on the emit channel as
`agentfootprint.agent.evidence_checked`, whatever the posture, so a
debugger can show the answer, the values and whether the revision fixed
them. The terminal verdict is readable after the run with
`agent.unsupportedValues()`.

#### Parameters

##### opts?

[`NamesAndNumbersOptions`](/agentfootprint/api/generated/interfaces/NamesAndNumbersOptions.md)

#### Returns

`this`

#### Example

```ts
const agent = Agent.create({ provider, model })
    .tool(showInterface)
    .namesAndNumbersFromEvidence({
      posture: 'guard',
      // The default extractor guesses from digits and punctuation; teach
      // it your domain's shapes and they are checked by name.
      shapes: [{ name: 'wwn', match: /(?:[0-9a-f]{2}:){7}[0-9a-f]{2}/ }],
      exempt: ['v9.35.0'],
    })
    .build();
```

***

### outputFallback()

> **outputFallback**\<`T`\>(`options`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1907](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1907)

3-tier degradation for output-schema validation failures. Pairs
with `.outputSchema()` — an agent that has one and not the other is
refused at `.build()`, in either call order.

Three tiers:

  1. **Primary** — LLM emitted schema-valid JSON. Caller gets it.
  2. **Fallback** — `OutputSchemaError` thrown. The async
     `fallback(error, raw)` runs; its return is re-validated.
  3. **Canned** — static safety-net value. NEVER throws when set.

`canned` is validated against the schema at `.build()` — fail-fast on
misconfig (a `canned` that doesn't validate would defeat the fail-open
guarantee at the exact moment it is needed).

## The tiers run at the TYPED boundary — `run()` does not reach them

`runTyped()` and `parseOutputAsync()` engage the chain. **`run()` does
not**, and cannot: these tiers produce a typed value `T`, and `run()`
resolves to the raw answer string — substituting a fallback there would
hand a caller a different answer than the model gave, invisibly. So an
agent consumed through `run()` (a server route, a queue worker,
`standingAgent`) gets NO fallback, and until 8.18.0 nothing said so. Now
the unmet-contract warning and
`agentfootprint.agent.output_contract_unmet` both carry
`fallbackConfigured: true` — the signal that a safety net exists and this
caller is not standing under it.

Two typed events fire on tier transitions for observability:
  - `agentfootprint.resilience.output_fallback_triggered`
  - `agentfootprint.resilience.output_canned_used` — carries
    `retriesSpent`, and warns when the canned value lands after re-asks
    that were billed. With `canned` set, `runTyped()` is structurally
    unable to throw, so nothing else would report that spend.

#### Type Parameters

##### T

`T`

#### Parameters

##### options

[`OutputFallbackOptions`](/agentfootprint/api/generated/interfaces/OutputFallbackOptions.md)\<`T`\>

#### Returns

`this`

#### Example

```ts
import { z } from 'zod';
const Refund = z.object({ amount: z.number(), reason: z.string() });

const agent = Agent.create({...})
  .outputSchema(Refund)
  .outputFallback({
    fallback: async (err, raw) => ({ amount: 0, reason: 'manual review' }),
    canned:   { amount: 0, reason: 'unable to process' },
  })
  .build();
```

***

### outputSchema()

> **outputSchema**\<`T`\>(`parser`, `opts?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1828](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1828)

#### Type Parameters

##### T

`T`

#### Parameters

##### parser

[`OutputSchemaParser`](/agentfootprint/api/generated/interfaces/OutputSchemaParser.md)\<`T`\>

##### opts?

[`OutputSchemaOptions`](/agentfootprint/api/generated/interfaces/OutputSchemaOptions.md)

#### Returns

`this`

***

### rag()

> **rag**(`definition`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1572](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1572)

Register a RAG retriever — semantic search over a vector-indexed
corpus. Identical plumbing to `.memory()` (RAG resolves to a
`MemoryDefinition` produced by `defineRAG()`); this alias exists
so the consumer's intent reads clearly:

```ts
agent
  .memory(shortTermConversation)   // remembers what the USER said
  .rag(productDocs)                // retrieves what the CORPUS says
  .build();
```

Both end up as memory subflows, but the alias separates "user
conversation memory" from "document corpus retrieval" in code
intent, ids, and Lens chips.

#### Parameters

##### definition

`MemoryDefinition`

#### Returns

`this`

***

### recipe()

> **recipe**(`recipe`, `options?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:533](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L533)

Apply a **recipe** — a named, versioned composition over the builder
methods below (9.48.0).

Every capability an agent needs already ships; what did not was a declared,
versioned, inspectable unit of CONFIGURATION. So an agent's setup lived as
prose in an example, was copy-pasted into an app, drifted there, and
afterwards nothing on the run could say which composition produced the
agent that answered. A recipe is that missing noun, and each applied one
puts an `{ id, version }` row on the run manifest.

`configure` runs SYNCHRONOUSLY and immediately — at the position in the
chain where you wrote `.recipe()`, so declaration order is application
order and a later call still wins the way it always has. There is no
deferred phase, nothing to close and nothing registered anywhere: see
AgentRecipe for why that limit is deliberate.

**Conflicts.** A tool name or injection id a recipe introduces that is
already taken refuses right here, naming BOTH sources — which recipe, or
the app itself. `'error'` is the only policy (`{ conflict }`); anything
else is refused by name rather than approximated.

#### Parameters

##### recipe

`AgentRecipe`

##### options?

`RecipeOptions`

#### Returns

`this`

#### Example

**an app composing two published recipes**

```ts
import { defineAgentRecipe } from 'agentfootprint/recipes';

const agent = Agent.create({ provider, model })
  .recipe(supportDesk)   // system prompt + order lookup
  .recipe(housePolicy)   // the steering every agent here carries
  .tool(escalate)        // and one tool this app adds itself
  .build();
```

***

### ~~recorder()~~

> **recorder**(`_rec`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1058](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1058)

REMOVED in 9.0.0 — use [AgentBuilder.watch](/agentfootprint/api/generated/classes/AgentBuilder.md#watch) instead.

This is a one-release grace error, not a method. Deprecated in 8.0.0 in
favour of `.watch(...)` — same list, same order, same attachment, and
`.watch()` takes more than one observer. The body was deleted in 9.0.0;
the NAME is kept for one major so a call site that missed the deprecation
gets a sentence instead of `builder.recorder is not a function`.

It throws at BUILD time, before any run, so the failure is deterministic
and lands in development rather than in a trace nobody is watching.

#### Parameters

##### \_rec

[`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

#### Returns

`this`

#### Deprecated

Removed in 9.0.0 — call `.watch(rec)`. This throwing stub is
deleted in 10.0.0.

***

### reliability()

> **reliability**(`config`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:2014](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2014)

Wire rules-based reliability around every `CallLLM` execution.
The framework wraps the LLM call in a retry/fallback/fail-fast
loop driven by `preCheck` and `postDecide` rules.

Decision verbs the rules can emit (see `ReliabilityDecision` for
the full list):

  • `continue`    — pre-check OK, proceed to the call
  • `ok`          — post-call OK, commit and return
  • `retry`       — re-call same provider (bumps `attempt`)
  • `retry-other` — advance to next provider in `providers[]`
  • `fallback`    — invoke `config.fallback(req, lastError)`
  • `fail-fast`   — throw `ReliabilityFailFastError` at `agent.run()`

**Streaming + reliability semantics — first-chunk arbitration:**
Pre-first-chunk failures (connection/headers/breaker-open) honor
the full rule set (retry, retry-other, fallback, fail-fast).
Post-first-chunk failures (mid-stream) honor only `ok` and
`fail-fast`; rules wanting `retry`/`retry-other`/`fallback` are
escalated to fail-fast with kind `'mid-stream-not-retryable'`.
This matches LangChain's `RunnableWithFallbacks` pattern and
the prevailing industry default — see the streaming + reliability
design memo for the full discussion.

Throws if called more than once on the same builder.

#### Parameters

##### config

`ReliabilityConfig`

#### Returns

`this`

#### Example

```ts
import { Agent } from 'agentfootprint';
  import { ReliabilityFailFastError } from 'agentfootprint/reliability';

  const agent = Agent.create({ provider, model: 'mock' })
    .system('Triage support tickets.')
    .reliability({
      postDecide: [
        { when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
          then: 'retry', kind: 'transient-retry' },
        { when: (s) => s.error !== undefined,
          then: 'fail-fast', kind: 'unrecoverable' },
      ],
      circuitBreaker: { failureThreshold: 3 },
    })
    .build();

  try {
    await agent.run({ message: 'help' });
  } catch (e) {
    if (e instanceof ReliabilityFailFastError) {
      console.log(e.kind, e.reason);
    }
  }
```

***

### selfExplain()

> **selfExplain**(`opts?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:2332](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2332)

#### Parameters

##### opts?

[`SelfExplainOptions`](/agentfootprint/api/generated/interfaces/SelfExplainOptions.md) = `{}`

#### Returns

`this`

***

### skill()

> **skill**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1154](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1154)

Register a Skill — LLM-activated, system-prompt + tools.
Auto-attaches the `read_skill` activation tool to the agent.
Skill stays active for the rest of the turn once activated.

#### Parameters

##### injection

`Injection`

#### Returns

`this`

***

### skillGraph()

> **skillGraph**(`graph`, `options?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1199](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1199)

Mount a declarative **skill graph** (proposal 002) — each skill carries a
graph-derived trigger (entry → always/rule, deterministic route → rule /
on-tool-return), so dynamic token-efficient loading becomes *declared* and
*drawable*. Pure sugar over `.injection()` — `graph.toMermaid()` renders the
topology.

The optional second argument (SG-C, 9.17.0) sets the MOUNT's routing
posture and cursor span — see [SkillGraphOptions](/agentfootprint/api/generated/interfaces/SkillGraphOptions.md). Omitted, the
agent behaves byte-for-byte as it always has.

#### Parameters

##### graph

###### deferredBodyContract?

\{ `mode`: `"warn"` \| `"throw"`; \}

The graph's note that it deferred its body-contract checks to agent build
 (built without `knownTools` — see `SkillGraph.deferredBodyContract`).
 Optional for forward-compat; absent → the checks already ran at graph build
 (or were off), so this agent never re-runs them. Library-built graphs also
 stamp the note on each compiled skill's metadata, which `build()` prefers —
 this field is the fallback for a structurally-typed graph without the
 per-skill stamps (skills found by both are deduped by id).

###### deferredBodyContract.mode

`"warn"` \| `"throw"`

###### edges?

readonly `object`[]

The declared edges. Read for ONE thing: which skills the graph wires, so the
 read_skill gate can tell a skill the graph routes from one it never mentions
 (see `openSkillIds` in `build()`). Optional for forward-compat with graphs
 built before `edges` existed; absent → the graph wires nothing.

###### entrySelection?

`"scorer"` \| `"model-read"` \| `"classify"`

How the graph picks a turn's starting entry (SG-C). Read for one
 refusal: `strictness: 'rails'` cannot honor `'model-read'`.

###### explainNextSkill?

(`ctx`) => `CursorMove`

The same cursor resolver, reporting the clause that won (8.5.0). Optional for
 forward-compat; absent → no `cursorMove` on `context.evaluated`.

###### nextSkill

(`ctx`) => `string` \| `undefined`

###### nodes?

readonly `object`[]

The drawn nodes. Read for TWO things: a `predicate` node means this graph is
 a decision `tree()` (the gate's refusal says so out loud), and the node-id
 set is what a continuity cursor is validated against (`droppedResume`).
 Derived here rather than added to `SkillGraph` as a mode field — the shape
 is already public, and one fact should not be declared twice.

###### reachableSkills?

(`currentSkillId?`) => readonly `string`[]

###### scoreEntries?

(`ctx`, `signal?`) => `Promise`\<`EntryScoring`\>

###### skills

readonly `Injection`[]

###### supersededEntries?

(`ctx`) => readonly `string`[]

The entries the cursor law superseded this iteration (8.15.0). Optional for
 forward-compat; absent → no `supersededIds` on `context.evaluated`.

###### turnRouting?

`TurnRoutingPlan`

The graph's turn-routing plan (SG-C) — tier-1 rules, intent candidates,
 the classifier and the resolved tie policy. Optional for forward-compat
 with graphs built before it existed; absent → the cascade cannot run
 (classify needs it; continuity degrades to nothing rather than guess).

##### options?

[`SkillGraphOptions`](/agentfootprint/api/generated/interfaces/SkillGraphOptions.md)

#### Returns

`this`

#### Examples

```ts
const graph = skillGraph()
    .entry(triage)
    .route(triage, sfp, { when: (r) => r.toolName === 'get_counters' && JSON.parse(r.result).crc > 0 })
    .build();
  Agent.create({ provider }).skillGraph(graph).build();
```

```ts
// The conversation keeps its place across turns, and the model may
  // route only when the router declared ambiguity:
  Agent.create({ provider })
    .skillGraph(graph, { continuity: 'conversation', strictness: 'guard' })
    .build();
```

***

### skills()

> **skills**(`registry`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1169](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1169)

Bulk-register every Skill in a `SkillRegistry`. Use for shared
skill catalogs across multiple Agents — register skills once on
the registry; attach the same registry to every consumer Agent.

#### Parameters

##### registry

###### list

#### Returns

`this`

#### Example

```ts
const registry = new SkillRegistry();
  registry.register(billingSkill).register(refundSkill);
  const supportAgent = Agent.create({ provider }).skills(registry).build();
  const escalationAgent = Agent.create({ provider }).skills(registry).build();
```

***

### steering()

> **steering**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1478](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1478)

Register a Steering doc — always-on system-prompt rule.
Use for invariant guidance: output format, persona, safety policies.

#### Parameters

##### injection

`Injection`

#### Returns

`this`

***

### system()

> **system**(`prompt`, `options?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:433](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L433)

Set the base system prompt.

#### Parameters

##### prompt

`string`

The system prompt text. Stable per-turn.

##### options?

Optional config. `cache` controls how the
  CacheDecision subflow treats this prompt block:
  - `'always'` (default) — cache the base prompt as a stable
    prefix anchor. Highest cache-hit rate; recommended for
    production agents whose system prompt rarely changes.
  - `'never'` — skip caching. Use if the prompt contains volatile
    content (timestamps, per-request user IDs).
  - `'while-active'` — semantically equivalent to `'always'` for
    the base prompt (it's always active by definition).
  - `{ until }` — conditional invalidation (e.g., flush after iter 5).

###### cache?

`CachePolicy`

#### Returns

`this`

***

### thinking()

> **thinking**(`opts`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:2107](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2107)

v2.14+ — REQUEST-side thinking activation. Tells the provider to
emit reasoning blocks alongside its response.

**What this does:** every LLM call carries
`LLMRequest.thinking = { budget }`. The AnthropicProvider
translates to `thinking: { type: 'enabled', budget_tokens: N }`
on the wire. The model spends up to `budget` reasoning tokens
before producing the visible response.

**Distinct from `.thinkingHandler()`:**
  - `.thinking({ budget })` = ASK the model to think (request side)
  - `.thinkingHandler(h)`   = NORMALIZE the response (response side)

Most consumers want both; auto-wired handler covers the response
side automatically when `.thinking()` is set on a thinking-capable
provider. Setting `.thinking()` without `.thinkingHandler(null)`
is the typical happy path.

**Provider compatibility:**
  - Anthropic: requires claude-sonnet-4-5 / opus-4-5 (or newer).
    Older models reject with HTTP 400.
  - OpenAI: ignores. o1/o3 reasoning is selected at the model id
    level; this field is a no-op for OpenAIProvider.

**Budget guidance:** Anthropic recommends 1024-32000 reasoning
tokens. `budget` MUST be less than the request's `max_tokens`
(defaults to 4096 in AnthropicProvider — bump via the request
`maxTokens` if budget > ~3000).

Calling twice throws — same shape as `.reliability()` /
`.outputSchema()`.

#### Parameters

##### opts

###### budget

`number`

#### Returns

`this`

#### Example

```ts
Agent.create({ provider: anthropic({...}), model: 'claude-sonnet-4-5' })
    .system('You are a careful reasoning agent.')
    .thinking({ budget: 5000 })   // ask Anthropic to think
    .build();
```

***

### thinkingHandler()

> **thinkingHandler**(`handler`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:2058](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2058)

Wire a thinking handler (v2.14+). Three usage patterns:

  • OMITTED (default) — framework auto-wires by `provider.name` via
    `findThinkingHandler` from the registry. Most consumers using
    a shipped provider get thinking support for free.

  • EXPLICIT handler — override the auto-wire. For custom providers
    or for swapping in a custom Anthropic/OpenAI handler with
    different normalization (e.g. redacting blocks before they
    land).

  • EXPLICIT `null` — opt out entirely. The thinking subflow is NOT
    mounted even if the provider would auto-match. Use when you
    want to skip thinking parsing for this agent (cost / latency /
    UX reasons).

Calling twice throws — same shape as `.reliability()` /
`.outputSchema()` to enforce single-source intent.

#### Parameters

##### handler

`ThinkingHandler` \| `null`

#### Returns

`this`

#### Examples

```ts
// Default — auto-wire AnthropicThinkingHandler for anthropic provider
  Agent.create({ provider: anthropic({...}), model: '...' }).build();
```

```ts
// Custom handler that redacts thinking content
  Agent.create({...}).thinkingHandler(myRedactingHandler).build();
```

```ts
// Opt out of thinking parsing entirely
  Agent.create({ provider: anthropic({...}), model: '...' })
    .thinkingHandler(null)
    .build();
```

***

### thinkingTemplates()

> **thinkingTemplates**(`templates`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1101](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1101)

Override agentfootprint's bundled thinking templates. Same
contract shape as commentary; different vocabulary — first-person
status the chat bubble shows mid-call. Per-tool overrides go via
`tool.<toolName>` keys (e.g., `'tool.weather': 'Looking up the
weather…'`). See `defaultStatusTemplates` for the full key list.

#### Parameters

##### templates

`Readonly`\<`Record`\<`string`, `string`\>\>

#### Returns

`this`

***

### tool()

> **tool**\<`TArgs`, `TResult`\>(`tool`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:454](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L454)

#### Type Parameters

##### TArgs

`TArgs`

##### TResult

`TResult`

#### Parameters

##### tool

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`TArgs`, `TResult`\>

#### Returns

`this`

***

### toolMiddleware()

> **toolMiddleware**(...`middleware`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:2227](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L2227)

Wrap every tool dispatch in a governance chain.

Each middleware answers with one of three verbs — `allow()`, `deny(reason)`
or `ask({ question })` — and there is deliberately no fourth. In
particular there is no way to return a result: whatever the chain decides,
the answer the model finally reads is the real tool's output or a refusal.
A rule cannot quietly become the tool.

- **`allow()`** passes the call through. **`allow(args, why)`** replaces
  the args and the run commits BOTH versions with your `why` beside them,
  so a slice taken later can find the moment they changed and who changed
  them.
- **`deny(reason)`** refuses. The reason reaches the model verbatim, as
  the tool result, and the loop continues — the agent adapts in-flight. A
  denial is data, not a crash.
- **`ask({ question })`** suspends the run for a person, on the same
  checkpoint machinery `checkIn` and `askHuman` use. The answer is a
  DECISION, not a result: approve and the chain resumes and the real tool
  runs; decline and it becomes a denial the model reads.

Order is call order, and each middleware sees the previous one's output.
The first non-allow answer wins and the rest of the chain does not run. A
middleware that throws is a denial carrying the error as its reason —
never a silent pass.

A link may also carry an **`onToolResult`** hook, which decides about the
RESULT once the tool has run and before the model reads it — `allow()`,
`allow(value, why)` or `deny(reason)`, and no `ask`, because the tool has
already run and there is nothing left for a person to prevent. That half
of the chain is walked BACKWARDS, so the first-declared rule has the first
word about the call and the last word about the answer. A link with only
`onToolResult` takes no part in dispatch at all.

`.act({ beforeTool, afterTool })` is the same chain, named by moment.

An existing `PermissionChecker` still decides FIRST: it is not part of
this chain, it runs ahead of it, so a call it denies never reaches a
middleware. `gatedTools` is a different layer again — it decides which
tools the model can SEE; this decides what happens when one is called.

Omit this and nothing changes: no chain walk, no committed ledger key, the
same request bytes.

#### Parameters

##### middleware

...readonly [`ToolMiddleware`](/agentfootprint/api/generated/type-aliases/ToolMiddleware.md)[]

#### Returns

`this`

#### Example

```ts
import { Agent, allow, deny } from 'agentfootprint';

const agent = Agent.create({ provider, model })
  .toolMiddleware({
    name: 'no-prod-writes',
    onToolCall: (call) =>
      call.args.env === 'prod' ? deny('writes to prod need a change ticket') : allow(),
  })
  .build();
```

***

### toolProvider()

> **toolProvider**(`provider`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:631](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L631)

Wire a chainable `ToolProvider` (from `agentfootprint/providers`)
as the agent's per-iteration tool source.

The provider is consulted EVERY iteration via `provider.list(ctx)`
with `ctx = { iteration, activeSkillId, identity }`. Tools the
provider emits flow into the Tools slot alongside any static
tools registered via `.tool()` / `.tools()`. The tool-call
dispatcher also consults the provider so dynamic chains
(`gatedTools`, `skillScopedTools`) dispatch correctly when their
visible-set changes mid-turn.

Throws if called more than once on the same builder (avoids
silent override surprises).

#### Parameters

##### provider

`ToolProvider`

#### Returns

`this`

#### Example

```ts
Permission-gated baseline
  import { gatedTools, staticTools } from 'agentfootprint/providers';
  import { PermissionPolicy } from 'agentfootprint/security';

  const policy = PermissionPolicy.fromRoles({
    readonly: ['lookup', 'list_skills', 'read_skill'],
    admin:    ['lookup', 'list_skills', 'read_skill', 'delete'],
  }, 'readonly');

  const provider = gatedTools(
    staticTools(allTools),
    (toolName) => policy.isAllowed(toolName),
  );

  const agent = Agent.create({ provider: llm, model })
    .system('You answer.')
    .toolProvider(provider)
    .build();
```

***

### tools()

> **tools**(`tools`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:592](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L592)

Register many tools at once. Convenience for tool sources that
return a list (e.g., `await mcpClient(...).tools()`). Each tool
is registered via `.tool()` so duplicate-name validation still
fires per-entry.

#### Parameters

##### tools

readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

#### Returns

`this`

***

### toolsFromActiveSkill()

> **toolsFromActiveSkill**(): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1813](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1813)

Offer a skill's tools **only while that skill is active** (9.36.0). One
line, for every skill on the agent.

## What it fixes

By default a skill's `tools` go into the agent's STATIC tool list at build
time, so the model can see and call them from iteration 1 — activated or
not. Narrowing that was a per-skill field (`defineSkill({ autoActivate:
'currentSkill' })`) you had to remember on every skill; the one you forgot
kept its tools on the wire for the life of the agent, and nothing said so.
This says it once, for all of them.

With it on, a skill's tools enter the request on the iterations where the
skill is active — through the same readmission path `autoActivate` has used
since v2.5 — and nowhere else. Everything else is untouched: `read_skill`,
`list_skills`, your `.tool()` registry, provider tools and every other
active skill's tools stay offered, because a scoped agent still has to
handle the input nobody imagined.

## Not a posture dial, and why

`.skillGraph({ strictness })` and `.namesAndNumbersFromEvidence({ posture })`
take three values because there is a real middle there — record it, revise
it, refuse it. The wire has no middle: a tool's schema is either in the
request or it is not, and "record that we sent it" is just sending it. A
three-value dial here would ship one behaviour under two names.

## What it does NOT do

It governs the OFFER, not dispatch. A tool stays resolvable by name so an
active skill's call lands — the split `autoActivate` has always had. If you
need execution itself gated (an inactive skill's tool refused even when the
model names it from a restored transcript), that is a `PermissionChecker`
or a `gatedTools` provider, and it is a different question: authority to
run, not what the model was shown.

## Interaction with the per-skill flag and with `scopeTools`

All three stamp the same field, and none can contradict another:
`autoActivate` has one legal value, so a skill can ask to be scoped and can
never ask to be exempt. A skill that declared its own keeps it; the graph's
`scopeTools: true` fills in the skills it wires; this fills in the rest.
Turning it on can only remove tools from the static list, never add one.

**Opt-in in 9.x.** The default is unchanged — an agent that never calls
this builds byte-identical bytes and emits byte-identical events. The
default flips in 10.0.0, the same ledger `skillGraph({ scopeTools })` is on.

#### Returns

`this`

#### Example

```ts
const skills = await skillsFromDir('./skills', { tools: [lookupOrder, issueRefund] });
  const agent = Agent.create({ provider, model })
    .skills({ list: () => skills })
    .toolsFromActiveSkill()   // billing's tools appear when billing does
    .build();
```

***

### watch()

> **watch**(...`observers`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1038](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L1038)

Watch this agent. `.act()` says what the agent may do; `.watch()` says
who is looking while it does it.

Every observer handed here is attached before `build()` returns, so it
sees every event from the very first run — there is no window where the
agent has run and nobody was watching.

Variadic, because observers come in sets:

```ts
const agent = Agent.create({ provider, model })
  .watch(toolChoiceRecorder(), routeRecorder())
  .act({ beforeTool: [budgetGuard] })
  .build();
```

Build time, not run time. This returns the builder; `agent.attach(o)`
attaches to a live agent and returns an `Unsubscribe` you own. Same
mechanism underneath — `.watch()` replays through `agent.attach()` at
the end of `build()` — so mixing the two is fine and order is preserved.

Called more than once, the sets concatenate in call order. Nothing is
de-duplicated here; footprintjs's executor dedupes by recorder id at run
time, so the same observer handed in twice still fires once.

#### Parameters

##### observers

...readonly [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)[]

#### Returns

`this`

***

### window()

> **window**(`strategy`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:824](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/AgentBuilder.ts#L824)

Choose how the live context window is kept inside its budget.

This is the general door; the strategy decides everything about WHEN it
acts and WHAT leaves. Three ship, and they share one turn segmentation
and one refusal engine, so a refusal reason means the same thing under
all of them:

  `summarizeOldest({ thresholdTokens, summarizer, ... })`
     fold the oldest span into one summary message. `.compaction()` is
     this, spelled shorter.
  `slidingWindow({ keepRecentTurns })`
     keep the last N turns and drop older ones. No summarizer, no LLM
     call, no usage requirement — it runs on any provider.
  `tokenBudget({ thresholdTokens })`
     the counted-token trigger, dropping instead of summarizing.

Never removed by any of them: the system envelope, the recent turns, and
any turn holding something unresolved — an unanswered tool call, a paused
tool, a pending check-in. Those refuse BY NAME in the record and the
strategy takes the next oldest instead. Removing an unanswered question
would destroy the referent of the answer that has not arrived yet, and
splitting a `tool_use` from its `tool_result` produces a request the
vendor rejects.

**Whatever leaves the window stays in the ledger.** footprintjs's commit
log is append-only, so the turns were committed before the strategy ran
and remain byte-identical; every strategy files its own recorded step
naming the `runtimeStageId`s whose messages left, and emits one
`context.evicted` per message. Removing is not forgetting.

Exactly one strategy per agent. Omit this (and `.compaction()`) and
nothing changes: no stage, no extra committed key, the same request bytes.

#### Parameters

##### strategy

[`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

#### Returns

`this`

#### Example

```ts
import { Agent, slidingWindow } from 'agentfootprint';

const agent = Agent.create({ provider, model })
  .window(slidingWindow({ keepRecentTurns: 12 }))
  .build();
```
