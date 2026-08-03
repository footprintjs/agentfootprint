---
title: AgentBuilder
---

# Class: AgentBuilder

Defined in: [src/core/agent/AgentBuilder.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L51)

Fluent builder. `tool()` accepts any Tool<TArgs, TResult> and registers
it by its schema.name. Duplicate names throw at build time.

## Constructors

### Constructor

> **new AgentBuilder**(`opts`): `AgentBuilder`

Defined in: [src/core/agent/AgentBuilder.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L170)

#### Parameters

##### opts

[`AgentOptions`](/docs/api/interfaces/AgentOptions)

#### Returns

`AgentBuilder`

## Methods

### appName()

> **appName**(`name`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:502](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L502)

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

> **build**(): [`Agent`](/docs/api/classes/Agent)

Defined in: [src/core/agent/AgentBuilder.ts:1170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L1170)

#### Returns

[`Agent`](/docs/api/classes/Agent)

***

### checkIn()

> **checkIn**(`opts?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L1143)

#### Parameters

##### opts?

[`CheckInBuilderOptions`](/docs/api/interfaces/CheckInBuilderOptions) = `{}`

#### Returns

`this`

***

### commentaryTemplates()

> **commentaryTemplates**(`templates`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:517](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L517)

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

Defined in: [src/core/agent/AgentBuilder.ts:431](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L431)

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

[`CompactionOptions`](/docs/api/interfaces/CompactionOptions)

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

Defined in: [src/core/agent/AgentBuilder.ts:309](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L309)

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

Defined in: [src/core/agent/AgentBuilder.ts:649](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L649)

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

Defined in: [src/core/agent/AgentBuilder.ts:545](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L545)

Register any `Injection`. Use this for power-user / custom flavors;
for built-in flavors use the typed sugar (`.skill`, `.steering`,
`.instruction`, `.fact`).

#### Parameters

##### injection

`Injection`

#### Returns

`this`

***

### instruction()

> **instruction**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:627](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L627)

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

Defined in: [src/core/agent/AgentBuilder.ts:638](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L638)

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

### maxIterations()

> **maxIterations**(`n`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:473](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L473)

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

Defined in: [src/core/agent/AgentBuilder.ts:676](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L676)

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

Defined in: [src/core/agent/AgentBuilder.ts:1119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L1119)

Wrap the message boundary in a governance chain — the input before the
model sees it, the output before the caller receives it.

Same verbs as [toolMiddleware](/docs/api/classes/AgentBuilder#toolmiddleware) minus one: there is no `ask` here,
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

...readonly [`MessageMiddleware`](/docs/api/interfaces/MessageMiddleware)[]

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

### outputFallback()

> **outputFallback**\<`T`\>(`options`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:794](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L794)

3-tier degradation for output-schema validation failures. Pairs
with `.outputSchema()` — calling `.outputFallback()` without an
`outputSchema` first throws (the fallback has nothing to validate).

Three tiers:

  1. **Primary** — LLM emitted schema-valid JSON. Caller gets it.
  2. **Fallback** — `OutputSchemaError` thrown. The async
     `fallback(error, raw)` runs; its return is re-validated.
  3. **Canned** — static safety-net value. NEVER throws when set.

`canned` is validated against the schema at builder time —
fail-fast on misconfig (a `canned` that doesn't validate would
defeat the fail-open guarantee).

Two typed events fire on tier transitions for observability:
  - `agentfootprint.resilience.output_fallback_triggered`
  - `agentfootprint.resilience.output_canned_used`

#### Type Parameters

##### T

`T`

#### Parameters

##### options

[`OutputFallbackOptions`](/docs/api/interfaces/OutputFallbackOptions)\<`T`\>

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

Defined in: [src/core/agent/AgentBuilder.ts:739](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L739)

Declarative terminal contract. The agent's final answer must be
JSON matching `parser`. Auto-injects a system-prompt instruction
telling the LLM the shape, and exposes `agent.runTyped()` /
`agent.parseOutput()` for parse + validate at the call site.

The `parser` is duck-typed: any object with a `parse(unknown): T`
method works (Zod, Valibot, ArkType, hand-written). The optional
`description` field on the parser drives the auto-generated
instruction; consumers can also override via `opts.instruction`.

Throws if called more than once on the same builder (avoids
silent override surprises).

#### Type Parameters

##### T

`T`

#### Parameters

##### parser

[`OutputSchemaParser`](/docs/api/interfaces/OutputSchemaParser)\<`T`\>

Validation strategy that throws on shape failure.

##### opts?

[`OutputSchemaOptions`](/docs/api/interfaces/OutputSchemaOptions)

Optional `{ name, instruction }` to customize.

#### Returns

`this`

#### Example

```ts
import { z } from 'zod';
  const Output = z.object({
    status: z.enum(['ok', 'err']),
    items: z.array(z.string()),
  }).describe('A status enum + an array of strings.');

  const agent = Agent.create({...})
    .outputSchema(Output)
    .build();

  const typed = await agent.runTyped({ message: '...' });
  typed.status; // narrowed to 'ok' | 'err'
```

***

### rag()

> **rag**(`definition`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:704](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L704)

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

### recorder()

> **recorder**(`rec`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:491](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L491)

Attach a footprintjs `CombinedRecorder` to the built Agent. Wired
via `agent.attach(rec)` immediately after construction, so the
recorder sees every event from the very first run.

Equivalent to calling `agent.attach(rec)` post-build; the builder
method is a convenience for codebases that prefer fully-fluent
agent assembly. Multiple recorders are supported (each gets its
own `attach()` call).

#### Parameters

##### rec

[`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)

#### Returns

`this`

***

### reliability()

> **reliability**(`config`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:870](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L870)

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

Defined in: [src/core/agent/AgentBuilder.ts:1151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L1151)

#### Parameters

##### opts?

[`SelfExplainOptions`](/docs/api/interfaces/SelfExplainOptions) = `{}`

#### Returns

`this`

***

### skill()

> **skill**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:558](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L558)

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

> **skillGraph**(`graph`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:592](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L592)

Mount a declarative **skill graph** (proposal 002) — each skill carries a
graph-derived trigger (entry → always/rule, deterministic route → rule /
on-tool-return), so dynamic token-efficient loading becomes *declared* and
*drawable*. Pure sugar over `.injection()` — `graph.toMermaid()` renders the
topology.

#### Parameters

##### graph

###### nextSkill

(`ctx`) => `string` \| `undefined`

###### reachableSkills?

(`currentSkillId?`) => readonly `string`[]

###### scoreEntries?

(`ctx`, `signal?`) => `Promise`\<`EntryScoring`\>

###### skills

readonly `Injection`[]

#### Returns

`this`

#### Example

```ts
const graph = skillGraph()
    .entry(triage)
    .route(triage, sfp, { when: (r) => r.toolName === 'get_counters' && JSON.parse(r.result).crc > 0 })
    .build();
  Agent.create({ provider }).skillGraph(graph).build();
```

***

### skills()

> **skills**(`registry`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:573](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L573)

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

Defined in: [src/core/agent/AgentBuilder.ts:618](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L618)

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

Defined in: [src/core/agent/AgentBuilder.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L194)

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

Defined in: [src/core/agent/AgentBuilder.ts:963](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L963)

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

Defined in: [src/core/agent/AgentBuilder.ts:914](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L914)

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

Defined in: [src/core/agent/AgentBuilder.ts:529](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L529)

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

Defined in: [src/core/agent/AgentBuilder.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L202)

#### Type Parameters

##### TArgs

`TArgs`

##### TResult

`TResult`

#### Parameters

##### tool

[`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult`\>

#### Returns

`this`

***

### toolMiddleware()

> **toolMiddleware**(...`middleware`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:1073](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L1073)

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

An existing `PermissionChecker` still decides FIRST: it is not part of
this chain, it runs ahead of it, so a call it denies never reaches a
middleware. `gatedTools` is a different layer again — it decides which
tools the model can SEE; this decides what happens when one is called.

Omit this and nothing changes: no chain walk, no committed ledger key, the
same request bytes.

#### Parameters

##### middleware

...readonly [`ToolMiddleware`](/docs/api/interfaces/ToolMiddleware)[]

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

Defined in: [src/core/agent/AgentBuilder.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L256)

Wire a chainable `ToolProvider` (from `agentfootprint/tool-providers`)
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
  import { gatedTools, staticTools } from 'agentfootprint/tool-providers';
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

Defined in: [src/core/agent/AgentBuilder.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L217)

Register many tools at once. Convenience for tool sources that
return a list (e.g., `await mcpClient(...).tools()`). Each tool
is registered via `.tool()` so duplicate-name validation still
fires per-entry.

#### Parameters

##### tools

readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

#### Returns

`this`

***

### window()

> **window**(`strategy`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:369](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L369)

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

[`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

#### Returns

`this`

#### Example

```ts
import { Agent, slidingWindow } from 'agentfootprint';

const agent = Agent.create({ provider, model })
  .window(slidingWindow({ keepRecentTurns: 12 }))
  .build();
```
