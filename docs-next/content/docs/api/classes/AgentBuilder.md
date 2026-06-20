---
title: AgentBuilder
---

# Class: AgentBuilder

Defined in: [src/core/agent/AgentBuilder.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L45)

Fluent builder. `tool()` accepts any Tool<TArgs, TResult> and registers
it by its schema.name. Duplicate names throw at build time.

## Constructors

### Constructor

> **new AgentBuilder**(`opts`): `AgentBuilder`

Defined in: [src/core/agent/AgentBuilder.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L152)

#### Parameters

##### opts

[`AgentOptions`](/docs/api/interfaces/AgentOptions)

#### Returns

`AgentBuilder`

## Methods

### appName()

> **appName**(`name`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:285](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L285)

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

Defined in: [src/core/agent/AgentBuilder.ts:804](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L804)

#### Returns

[`Agent`](/docs/api/classes/Agent)

***

### commentaryTemplates()

> **commentaryTemplates**(`templates`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:300](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L300)

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

### fact()

> **fact**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:432](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L432)

Register a Fact — developer-supplied data the LLM should see.
User profile, env info, computed summary, current time, …
Distinct from Skills (LLM-activated guidance) and Steering
(always-on rules) in INTENT — the engine treats them all alike.

#### Parameters

##### injection

[`Injection`](/docs/api/interfaces/Injection)

#### Returns

`this`

***

### injection()

> **injection**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:328](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L328)

Register any `Injection`. Use this for power-user / custom flavors;
for built-in flavors use the typed sugar (`.skill`, `.steering`,
`.instruction`, `.fact`).

#### Parameters

##### injection

[`Injection`](/docs/api/interfaces/Injection)

#### Returns

`this`

***

### instruction()

> **instruction**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:410](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L410)

Register an Instruction — rule-based system-prompt guidance.
Predicate runs each iteration. Use for context-dependent rules
including the "Dynamic ReAct" `on-tool-return` pattern.

#### Parameters

##### injection

[`Injection`](/docs/api/interfaces/Injection)

#### Returns

`this`

***

### instructions()

> **instructions**(`injections`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:421](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L421)

Bulk-register many instructions at once. Convenience for consumer
code that organizes its instruction set in a flat array (`const
instructions = [outputFormat, dataRouting, ...]`). Each element
is registered via `.instruction()` so duplicate-id checks still
fire per-entry.

#### Parameters

##### injections

readonly [`Injection`](/docs/api/interfaces/Injection)[]

#### Returns

`this`

***

### maxIterations()

> **maxIterations**(`n`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L256)

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

Defined in: [src/core/agent/AgentBuilder.ts:459](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L459)

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

[`MemoryDefinition`](/docs/api/interfaces/MemoryDefinition)

#### Returns

`this`

***

### outputFallback()

> **outputFallback**\<`T`\>(`options`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:577](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L577)

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

Defined in: [src/core/agent/AgentBuilder.ts:522](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L522)

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

Defined in: [src/core/agent/AgentBuilder.ts:487](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L487)

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

[`MemoryDefinition`](/docs/api/interfaces/MemoryDefinition)

#### Returns

`this`

***

### recorder()

> **recorder**(`rec`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L274)

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

Defined in: [src/core/agent/AgentBuilder.ts:653](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L653)

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

Defined in: [src/core/agent/AgentBuilder.ts:785](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L785)

Let this agent answer why-questions about its OWN previous completed
turn, from its recorded trace. Mounts one skill: day to day the tool
catalog carries only the skill's activation row; when the user asks
"why did you…", the LLM activates it and that iteration alone gets
the trace tools (inline mode) or a single `explain_run` tool that
runs a nested trace debugger on a cheaper model (delegate mode).

Evidence binds LATE — always to the previous COMPLETED run, never
the in-flight one — and includes control edges (a per-run
control-dependence recorder is attached automatically).

#### Parameters

##### opts?

[`SelfExplainOptions`](/docs/api/interfaces/SelfExplainOptions) = `{}`

#### Returns

`this`

#### Examples

```ts
Agent.create({ provider, model })
    .system('You are a refunds assistant.')
    .tool(lookupOrder)
    .selfExplain()                                 // inline, zero config
    .build();
```

```ts
.selfExplain({ delegate: { provider: anthropic(), model: 'claude-haiku-4-5' } })
```

***

### skill()

> **skill**(`injection`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L341)

Register a Skill — LLM-activated, system-prompt + tools.
Auto-attaches the `read_skill` activation tool to the agent.
Skill stays active for the rest of the turn once activated.

#### Parameters

##### injection

[`Injection`](/docs/api/interfaces/Injection)

#### Returns

`this`

***

### skillGraph()

> **skillGraph**(`graph`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:375](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L375)

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

(`ctx`, `signal?`) => `Promise`\<[`EntryScoring`](/docs/api/interfaces/EntryScoring)\>

###### skills

readonly [`Injection`](/docs/api/interfaces/Injection)[]

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

Defined in: [src/core/agent/AgentBuilder.ts:356](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L356)

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

Defined in: [src/core/agent/AgentBuilder.ts:401](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L401)

Register a Steering doc — always-on system-prompt rule.
Use for invariant guidance: output format, persona, safety policies.

#### Parameters

##### injection

[`Injection`](/docs/api/interfaces/Injection)

#### Returns

`this`

***

### system()

> **system**(`prompt`, `options?`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L176)

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

Defined in: [src/core/agent/AgentBuilder.ts:746](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L746)

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

Defined in: [src/core/agent/AgentBuilder.ts:697](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L697)

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

Defined in: [src/core/agent/AgentBuilder.ts:312](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L312)

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

Defined in: [src/core/agent/AgentBuilder.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L184)

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

### toolProvider()

> **toolProvider**(`provider`): `this`

Defined in: [src/core/agent/AgentBuilder.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L238)

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

[`ToolProvider`](/docs/api/interfaces/ToolProvider)

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

Defined in: [src/core/agent/AgentBuilder.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L199)

Register many tools at once. Convenience for tool sources that
return a list (e.g., `await mcpClient(...).tools()`). Each tool
is registered via `.tool()` so duplicate-name validation still
fires per-entry.

#### Parameters

##### tools

readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

#### Returns

`this`
