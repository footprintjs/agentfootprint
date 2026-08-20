---
name: agentfootprint
description: Use when building AI agents with agentfootprint — LLMCall, Agent, skills, RAG, memory, control flow, Swarm concepts, mock/anthropic/openai/ollama providers, tools, recorders, resilience, and streaming. Also use when someone asks how agentfootprint works or wants to understand the framework.
---

# agentfootprint — The Explainable Agent Framework

agentfootprint structures AI agents as composable flowcharts, so every injection, read, write, decision and tool call becomes connected evidence as the run happens. Every concept takes an `LLMProvider` — swap `mock({...})` for `anthropic({...})` with zero code changes.

**Core principles:**
- Adapter-swap testing ($0 test runs, deterministic assertions)
- The ladder: `mock` → `ollama` (free, local, real model) → a paid provider
- Declare context (facts, steering, skills); the framework decides WHEN it fires and WHICH slot it lands in
- Collect during traversal, never post-process (inherited from footprintjs)

```bash
npm install agentfootprint footprintjs
```

## Read this first — what does NOT exist

These are not hypothetical. A capable author, working from a correct mental model of
this library, invented all four in one document. Treat them as the things you are
most likely to get wrong here.

| You will reach for | The reality |
|---|---|
| `startRun(...)` | **No such function.** The door is `agent.run(input, options?)`, where `AgentInput = { message: string; identity?; continueFrom? }` and `AgentOutput = string`. `run()` returns `AgentOutput \| RunnerPauseOutcome` — a run paused for a human returns a checkpoint; discriminate with `isPaused(result)`. |
| `RunStep` as skill/route history | **`RunStep` is real and it is something else** — the footprintjs flowchart TOPOLOGY slider, exported from `agentfootprint/observe`. Its `kind` is `'sequential' \| 'fork' \| 'merge' \| 'decide' \| 'iteration' \| 'iteration-exit' \| 'react'`. Nothing in it concerns skills. Importing it succeeds, which is exactly why it is dangerous. For route history use `routeRecorder()` from the same door. |
| the LLM classifier as routing "tier 3" | **It is a tier-2 strategy.** Tier 1 = declared start rules. Tier 2 = the configured scorer — `llmClassifier(provider)` OR `keywordScorer()` OR `embeddingScorer(e)` OR the entry scorer; near-ties fall through rather than argmax. Tier 3 = a menu the model resolves in-band through `read_skill`'s own description, reached only when tier 2 was NOT decisive. |
| a skill's tools being gated to that skill automatically | **They are not, by default.** `defineSkill({ tools })` puts them in the agent's static tool list at build time — visible from iteration 1 whether the skill ever activates or not. Ask for the gate: `.toolsFromActiveSkill()` (agent-wide), `skillGraph({ scopeTools: true })` (graph-wide), or `autoActivate: 'currentSkill'` (per skill). `.tree()` leaves are the one shape scoped by default. |

Two more absences: there is **no runtime force-stop governor** (`routeRecorder().getTrips()`
only *labels* a spinning run; `maxIterations` is the hard stop), and there is **no
automatic re-delivery of an ageing skill body** (`refreshPolicy` is stored and never
read on any version — use `surfaceMode: 'both'`).

## Subpath map — 13 doors

`agentfootprint` (main barrel: `Agent`, `LLMCall`, `defineTool`, control flow, patterns, `defineRAG`, pause/resume) · `/providers` (`mock`, `anthropic`, `openai`, `bedrock`, `ollama`, `mcpClient`, embedders — every provider, so bundlers never walk the vendor SDKs from the main barrel) · `/context` (`defineSkill`, `defineFact`, `defineSteering`, `defineInstruction`, `skillGraph`, `skillsFromDir`, the scorers) · `/memory` (`defineMemory`, `InMemoryStore`, `mockEmbedder`, the stores) · `/rag` (stores + loaders; `defineRAG` itself is on the main barrel) · `/observe` (recorders, tracing, `RunStep`) · `/resilience` (provider decorators) · `/reliability` (the rules-based fail-fast gate) · `/cache` (prefix-cache strategies; importing it registers them) · `/security` · `/hosting` · `/events` · `/skill-graph` (the routing layer with no framework attached, for a host that is not this agent).

## Core Concepts

### LLMCall — a single LLM call, no tools

```typescript
import { LLMCall } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const caller = LLMCall.create({ provider: mock({ reply: 'Hello!' }), model: 'mock' }).system('You are helpful.').build();
const result = await caller.run({ message: 'Hi' });
```

### Agent — a ReAct agent with tools

```typescript
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const weather = defineTool({
  name: 'weather',
  description: 'Get current weather for a city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  execute: async ({ city }: { city: string }) => `${city}: 72°F, sunny`,
});

const agent = Agent.create({ provider: mock({ reply: 'It is 72°F.' }), model: 'mock' })
  .system('You answer weather questions using the weather tool.')
  .tool(weather)
  .maxIterations(5)
  .build();

const result = await agent.run({ message: 'Weather in Paris?' });
```

### Context — facts, steering, skills, and declared routing

```typescript
import { defineFact, defineSteering, defineSkill, skillGraph } from 'agentfootprint/context';

Agent.create({ provider, model })
  .fact(defineFact({ id: 'user-profile', data: 'Plan: Pro · Customer since 2022' }))
  .steering(defineSteering({ id: 'policy', prompt: 'Never promise a refund before checking.' }))
  .skill(defineSkill({ id: 'refunds', description: 'Refund procedure.', body: '…', tools: [issueRefund] }))
  .build();
```

`defineSkill` bodies load on demand — the model opens one with `read_skill`, or a `skillGraph()` routes to it:

```typescript
const graph = skillGraph()
  .entry(triage, { when: (c) => /order/.test(c.userMessage) })   // where the turn STARTS
  .route(triage, refunds, { onToolReturn: 'lookup_order' })      // a declared handoff
  .build();

Agent.create({ provider, model }).skillGraph(graph).build();
graph.toMermaid();   // declared === drawn
```

`.entry()` and `.route()` take the skill OBJECTS, not their ids. The object form is
the other door — `skillGraph({ skills, start, steps })` returns a finished graph with
nothing to chain.

A skill is active exactly while the cursor is on it — one skill's turn at a time. An `.entry(x)` with **no** `when` is the persistent base (`always`), on beside whatever the cursor is on.

**The cursor is a program counter, not a per-turn classifier.** Nine causes move it (or
decline to), reported as `cursorMove.by` on `agentfootprint.context.evaluated` and as
`outcome` on `routeRecorder().getHops()`:

`'entry'` (cold start) · `'route'` (a declared `from`-gated edge fired) · `'tool-proposal'`
(a TOOL RESULT proposed a transition and the graph accepted it) · `'model-pick'` (a
gate-accepted `read_skill`) · `'intent'` (the tier-2 scorer was decisive) · `'continuity'`
(the cursor inherited from the previous turn held) · `'decider'` (an out-of-band menu
resolver) · `'stay'` (nothing fired — sticky, and a recorded decision, not an absence) ·
`'none'` (no cursor at all: nothing to enter, or a `tree()`, which has no cursor).
`routeRecorder`'s `RouteOutcome` is those eight minus `'none'` (no cursor, no hop) plus
`'rejected'` — nine values. Precedence when several want it at once:
**declared edge > accepted tool proposal > model pick > stay.** A suppressed pick emits
`agentfootprint.skill.reroute_superseded`; a parallel batch matching different targets
emits `agentfootprint.skill.route_conflict`.

**The cursor is per RUN by default.** A second `run()` starts cold at the entry.
`.skillGraph(graph, { continuity: 'conversation' })` makes it span the conversation.

**`read_skill` has a three-way design, not one list.** Per iteration a skill is
*reachable* (named under "Reachable from here"), *refusable* (named under "Not reachable
from here" — a graph refusal is about WHERE THE CURSOR IS, so naming it lets the model
route in one step), or *hidden* (absent entirely — a hidden skill is about WHO IS ASKING,
and naming it would leak the shape of somebody else's permissions; needs a
`PermissionChecker` governing `skill_read`). **The enum stays the full catalog in every
case** — narrowing it would turn a policy refusal into a generic schema error the model
never reads.

A refused pick gets one teaching sentence back and moves nothing:

```text
read_skill("audit-log") is not reachable from here. Reachable skills: billing. Pick one of these, or finish.
```

**The authority rule.** A tool result is written into the conversation once and then only
ages; the system prompt is rebuilt from nothing every iteration (`reactMode: 'dynamic'`,
the default, re-runs the InjectionEngine and all three slots). So standing instructions
belong in the recomposed surface. `reactMode: 'classic'` caches system-prompt and tools
after turn 1 — do **not** use it with skills.

### RAG — retrieve, augment, generate

```typescript
import { defineRAG } from 'agentfootprint';                    // wiring lives on the main barrel
import { InMemoryStore, mockEmbedder } from 'agentfootprint/memory';

Agent.create({ provider, model })
  .rag(defineRAG({ id: 'docs', store: new InMemoryStore(), embedder: mockEmbedder(), topK: 5 }))
  .build();
```

### Control flow + patterns — compose runners

```typescript
import { Sequence, Parallel, Loop, Conditional, workflow, graph } from 'agentfootprint';
import { swarm, debate, reflection, selfConsistency, mapReduce, tot } from 'agentfootprint';  // patterns

const pipeline = Sequence.create().step('research', researchAgent).step('write', writerAgent).build();

const desk = swarm({
  agents: [{ id: 'research', runner: researchAgent }, { id: 'write', runner: writerAgent }],
  route: ({ message }) => (/write/.test(message) ? 'write' : 'research'),
});
```

## Providers

```typescript
import { mock, anthropic, openai, bedrock, ollama } from 'agentfootprint/providers';

const provider = process.env.NODE_ENV === 'production'
  ? anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  : ollama('llama3.2');            // free local model; or mock({...}) for determinism
```

`mock` takes `{ reply }` (one fixed answer), `{ replies: [...] }` (consumed in order — exhaustion throws loud), or `{ respond: (req) => … }` (build the answer from the request, including `toolCalls`).

## Tools

```typescript
import { defineTool } from 'agentfootprint';

const calculator = defineTool({
  name: 'calculator',                                  // `name`, not `id`
  description: 'Perform arithmetic',
  inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
  execute: async ({ expression }: { expression: string }) => String(evaluate(expression)),
});
```

### A long tool that says where it is

```typescript
execute: async (args, ctx) => {
  for (const [i, hop] of hops.entries()) {
    await visit(hop);
    ctx.progress({ done: i + 1, total: hops.length });   // → stream.tool_progress
  }
  return summarize(hops);
},
```

`ctx.progress` is always present, never throws, never blocks, and never reaches
the model — the framework stamps `toolCallId` / `toolName` / `iteration`, you own
`payload`. `agent.on('agentfootprint.stream.*')` and `toSSE(agent)` carry it with
no extra wiring.

### When a tool finds nothing, and what a clean result does not cover

```typescript
import { absent, coverage, defineTool } from 'agentfootprint';

// "I looked and there is nothing" — never readable as "I could not look".
execute: ({ port }) => rows.length ? rows : absent({
  what: `FLOGI entries on ${port}`,
  checked: ['shq-fab-a: the live fcns database', 'window: the last 24h'],
  notChecked: [{ what: 'the archived history', why: 'older than the 24h window' }],
  cannotCover: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
  tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
}),

// A verdict WITH its boundary — what "fine" does and does not rule out.
execute: async () => coverage(await checkReplication(), {
  checked: ['SRDF pair state on all 4 arrays'],
  cannotCover: [{ what: 'host-side multipathing', why: 'no collector on the ESX hosts' }],
}),
```

An absence gets the delivered status `'absent'` (route it with
`onToolStatus: 'absent'`), files `agentfootprint.tools.absent`, and grounds only
its COVERAGE in the evidence gate — so an id the model invented does not become
grounded by one lookup that found nothing. It is never an error: nothing retries
it, nothing refuses it, no `error: true`. A ledger files
`agentfootprint.tools.coverage_declared`; add `.limitsTravelWithTheAnswer()` on
the agent and the framework APPENDS the run's limits to the final answer, so the
model cannot drop what it never wrote.

## Observing a run

```typescript
import { costRecorder, routeRecorder } from 'agentfootprint/observe';

const agent = Agent.create({ provider, model })
  .watch(routeRecorder({ id: 'routes' }))              // recorders are factories, not classes
  .build();

agent.on('agentfootprint.context.evaluated', (e) => console.log(e.payload.activeIds));
```

**106 typed events across 24 domains.** Two subscription shapes and no third:
`'*'` (every event) and `'agentfootprint.<domain>.*'` (one domain). **`'agentfootprint.*'`
is not a pattern** — TypeScript rejects it, and at runtime it would match nothing.

```typescript
agent.on('*', (e) => log(e));
agent.on('agentfootprint.stream.*', (e) => log(e));           // tool_start, tool_end, deltas
agent.on('agentfootprint.agent.turn_end', (e) =>
  console.log(`${e.payload.iterationCount} iterations`));
```

## Human in the loop

```typescript
import { askHuman, isPaused, checkInApproved } from 'agentfootprint';

const result = await agent.run({ message: 'Refund $500?' });
if (isPaused(result)) {
  const final = await agent.resume(result.checkpoint, checkInApproved({ by: 'maya' }));
}
```

## Resilience

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint/resilience';

const reliable = withRetry(provider, { maxAttempts: 3 });
const resilient = withFallback(primary, backup);
```

## Anti-Patterns

- Don't use `id`/`handler` on `defineTool` — it's `name`/`execute`
- Don't call `mock([...])` with an array — it's `mock({ replies: [...] })`
- Don't import any provider (`mock` included) from the main barrel — they live on `agentfootprint/providers`
- Don't `new` a recorder — they're lowercase factories attached via `.watch()`
- Don't write `.entry(x, { when: () => true })` for an always-on skill — omit `when`, or use `.steering()`
- Don't post-process execution — use recorders

## Checking your own wiring

```bash
npx agentfootprint-lint-tools tools.json   # confusable tool catalog — the CI gate
npx agentfootprint-index ./docs --to ./corpus.db   # build a RAG corpus at boot time
```

```typescript
const report = graph.checkup({ knownTools: ['lookup_order'] });   // unreachable skills, unknown edges, dead entries
if (!report.ok) throw new Error(formatCheckup(report));
```

## Going deeper

The full architecture of the skill graph — the three surfaces, the authority rule, the
nine cursor causes, the three-way `read_skill`, and a worked refusal taken from a real
run — is published as **Skill graph architecture**:
<https://footprintjs.github.io/agentfootprint/docs/build/skill-graph-architecture/>.
Every capability claim there carries a status — `shipped` / `opt-in` /
`application-provided` / `planned` — and every code block is type-checked against the
shipped types at build. Read it rather than this file when the question is "how does
routing actually work"; read this file for what to reach for and what does not exist.
