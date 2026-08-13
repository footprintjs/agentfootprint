

<h1 align="center">Agentfootprint</h1>

<p align="center">
  <strong>Your agent gave an answer that <em>looks</em> right — and it's wrong.<br/>The logs can't tell you who influenced it. Agentfootprint can.</strong>
</p>

<p align="center">
  The explainable AI agent framework for TypeScript: every read, write, decision, and tool call becomes
  <strong>connected evidence</strong> as your agent runs. When something goes wrong, you don't grep logs — you ask.
</p>

<p align="center">
  <strong>Build</strong> agents — skills, steering, RAG, memory, control flow — and <strong>debug</strong> them like nothing else.<br/>
  <em>Why</em> is a query, not a guess.
</p>

<p align="center">
  <a href="https://footprintjs.github.io/agentThinkingUI/">
    <img src="docs/assets/hero-atui.png" alt="An agent run replayed in Story Lens — the LLM 'brain' calls the Flight-search tool, the step inspector shows the tool's raw output and the brain's reasoning about it, and the timeline scrubs every step of the run." width="100%">
  </a>
</p>
<p align="center">
  <sub>A real run, replayed — rendered with <a href="https://github.com/footprintjs/agentThinkingUI"><b>Story Lens</b></a> (<code>npm i agentthinkingui</code>). Every frame is generated from the run's own trace; <a href="https://footprintjs.github.io/agentThinkingUI/">▶ watch it live</a>.</sub>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <!-- coverage-badge --><img src="https://img.shields.io/badge/coverage-87%25-green.svg" alt="coverage: 87%"><!-- /coverage-badge -->
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://bundlephobia.com/package/agentfootprint"><img src="https://img.shields.io/bundlephobia/minzip/agentfootprint?label=minzipped" alt="minzipped size"></a>
  <a href="#tree-shakeable--esm-first"><img src="https://img.shields.io/badge/tree--shakeable-%E2%9C%93-success?style=flat" alt="tree-shakeable"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/dm/agentfootprint.svg" alt="Downloads"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

---

## The new error class

For decades, software had two kinds of errors — and developers never needed deep
domain knowledge to fix either:

| Error class | Where the bug lives | How you find it |
|---|---|---|
| **Infrastructure** — crash, timeout, 500 | the system | infra logs, monitoring |
| **Business logic** — wrong branch, wrong math | the code | stack trace, debugger, `console.log` |
| **Contextual** — wrong tool chosen, wrong fact believed, stale memory trusted | **what the model was given** | **nothing. Until now.** |

Agents introduced the third class. The code is correct, the infra is healthy, the
answer even reads well — and the run is still wrong, because something influenced
the model:

| The model… | because… |
|---|---|
| picked the wrong tool | two descriptions read nearly alike — it chose between twins |
| believed a wrong "fact" | a tool returned it, or an injected fact planted it |
| followed the wrong instruction | the wrong skill / steering fired — or fired one iteration too early |
| answered from the past | a previous turn or stale memory bled into this one |

Classical logs can't explain any of it: **they record what the code did, never
what the context did.** The debugging question changed — no longer *"what did my
code do?"* but **"who influenced the model?"**

## The idea

If contextual errors live in what the model was given, then the run itself must be
structured so context is **evidence** — every injection, read, write, decision, and
tool call recorded *connected*, the moment it happens. Not logs you grep. Evidence
you ask.

## Quick start — runs offline, no API key

```bash
npm install agentfootprint footprintjs
```

```typescript
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const weather = defineTool({
  name: 'weather',
  description: 'Get current weather for a city.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  execute: async ({ city }: { city: string }) => `${city}: 72°F, sunny`,
});

const agent = Agent.create({
  provider: mock({ reply: 'I checked: it is 72°F and sunny.' }),
  model: 'mock',
})
  .system('You answer weather questions using the weather tool.')
  .tool(weather)
  .build();

const result = await agent.run({ message: 'Weather in Paris?' });
console.log(result);  // → "I checked: it is 72°F and sunny."
```

For production, import a real provider from `agentfootprint/providers` and swap it in — `anthropic(...)` / `openai(...)` / `bedrock(...)` / `ollama(...)`. Only the import line changes; the agent code stays the same. (The vendor-SDK providers live on the `agentfootprint/providers` subpath so the main `agentfootprint` barrel stays free of optional peer-dep requires; `mock`, `browserAnthropic`, and `browserOpenai` are on the main barrel.)

### Run against a local model — the free rung between the mock and the bill

No cloud account, no API key, no vendor SDK, $0 per token:

```typescript
import { Agent } from 'agentfootprint';
import { ollama } from 'agentfootprint/providers';

const agent = Agent.create({ provider: ollama('llama3.2'), model: 'llama3.2' }).build();
// → talks to http://localhost:11434 (run `ollama pull llama3.2` first)
```

This is the step that makes "the test run and the production run are the same code path" more than a slogan. A mock proves your control flow; it can't tell you whether a real model calls your tool, or what it makes of a tool description you wrote in a hurry. A local model can — and because it's free, you'll actually check before you pay.

`ollama()` talks Ollama's native API directly, so there's nothing to install on this side, streamed calls report real token counts (so `.compaction()` and cost budgets work), and when it can't work it says why in words that contain the fix — `ollama serve` when nothing is listening, `ollama pull <model>` when the model isn't there, never a raw connection error and never a hang.

For llama.cpp's `llama-server`, vLLM, Together or Groq, use `openai({ baseURL: 'http://localhost:8080/v1', apiKey: 'not-needed', defaultModel: '…' })` — any server speaking the OpenAI Chat Completions API, same `Agent` code either way. Full recipes: [Ollama guide](https://footprintjs.github.io/agentfootprint/docs/build/ollama/) · [OpenAI-compatible endpoints](https://footprintjs.github.io/agentfootprint/docs/build/openai/#openai-compatible-endpoints-ollama-llamacpp-vllm-together-groq-lm-studio).

### Then add context

A real agent carries more than one prompt and one tool: facts about the user, always-on rules, skills that unlock on demand. Declare each piece — the framework decides **when** it fires and **which slot** it lands in, and every piece is born tracked:

```typescript
import { defineFact, defineSteering, defineSkill } from 'agentfootprint/context';

const agent = Agent.create({ provider, model })
  .system('You are a support agent.')
  .fact(defineFact({                    // data the model should know — always on
    id: 'user-profile',
    data: 'Name: Maya · Plan: Pro · Customer since 2022',
  }))
  .steering(defineSteering({            // rules the model must follow — always on
    id: 'refund-policy',
    prompt: 'Never promise a refund before checking the policy tool.',
  }))
  .skill(defineSkill({                  // guidance the LLM loads when it asks
    id: 'billing',
    description: 'Use for refunds, charges, billing questions.',
    body: 'When handling billing: confirm identity first, then…',
    tools: [refundTool],
    autoActivate: 'currentSkill',       // ...and scope its tools to that window too
  }))
  .build();
```

Same shape for `.instruction()` / `.memory()` / `.rag()` / raw `.injection()` — they're all the one primitive, `Injection = slot × trigger × cache`. [The full model ↓](#the-model--what-we-abstract)

When a skill's playbook is really a **sequence**, declare it as data and the framework walks it — offering one step's tool at a time (banner-led: `[Step 2 of 6 — confirm the duplicate charge]`), with `skip_step` to put a decline on the record and one teaching nudge if the model stops early. Your other tools stay available throughout — a declared order, not a cage:

```typescript
defineSkill({
  id: 'refund',
  description: 'Handles refunds end to end, by declared procedure.',
  body: 'Follow the refund procedure. Every step says why it exists.',
  tools: [findOrder, checkHistory, issueRefund, fileReceipt],
  steps: [                                        // the procedure, as data (9.18.0)
    { tool: 'find_order',    note: 'find the order before touching money' },
    { tool: 'check_history', note: 'confirm the duplicate charge' },
    { tool: 'issue_refund',  note: 'refund the duplicate charge only' },
    { tool: 'file_receipt',  note: 'file the receipt for audit' },
  ],
});
```

Every move lands on the typed stream (`skill.step_advanced` / `step_skipped` / `steps_unfinished`), and a step whose tool asks a human pauses the run and advances on resume — [runnable end to end](examples/context-engineering/16-skill-steps.ts).

### Then keep the conversation

`run()` is **one turn**. It seeds the conversation from the message you pass and nothing else, so calling it twice gives you two conversations — right for one-shot work, and not what a chat wants. Continuing is something you name:

```typescript
await agent.run({ message: 'Book me a table for two on Friday.' });
await agent.followUp('Make it three.');            // same conversation

// …or hand the conversation around: plain JSON, any store, any machine.
const conversation = agent.checkpoint();
await agent.run({ message: 'Make it three.', continueFrom: conversation });
```

The conversation carries its own `identity`, so a continued turn writes its memory where the earlier turns can read it. Two things that *look* like this and are not: `identity.conversationId` is a namespace key (it scopes memory, RAG and permissions — it does not join two runs), and `.memory()` gives you **recall** in the system prompt rather than the verbatim window. `standingAgent({ agent, sessions, host })` does the whole store-and-continue dance per session for you. [Worked example, printing the wire each way →](examples/features/51-conversations.ts)

**The conversation keeps its place, too (9.17.0).** On a skill graph mounted with `.skillGraph(graph, { continuity: 'conversation' })`, the skill the last turn ended on rides the same checkpoint — `followUp('one more thing')` starts *there* instead of re-routing from scratch. A sticky default, never a lock: each new message is still judged by the graph's declared rules and intents (`match: { intent, examples }` + `classify:` a scorer), a decisively different topic moves, a genuinely ambiguous one offers the model a menu, and every verdict — winners, losers, the thresholds that judged them — is recorded as `agentfootprint.skill.turn_routed`. [The routing cascade, in five minutes →](docs-next/content/docs/build/skill-graph-quickstart.mdx) · [Runnable example →](examples/context-engineering/15-skill-graph-intents.ts)

### Then compose control flow

One agent is a `Runner`. So is every composition of agents — four control-flow primitives, and anything that runs composes into anything else:

```typescript
import { Sequence, Parallel, Conditional } from 'agentfootprint';

const pipeline = Sequence.create()
  .step('classify', classifyAgent)                  // sequence: step → step
  .step('review',
    Parallel.create()                               // parallel: fan out, then merge
      .branch('legal', legalAgent)
      .branch('ethics', ethicsAgent)
      .mergeWithLLM({ provider, model, prompt: 'Synthesize:' })
      .build())
  .step('respond',
    Conditional.create()                            // conditional: one branch runs
      .when('urgent', (i) => i.message.startsWith('URGENT'), urgentAgent)
      .otherwise('normal', normalAgent)
      .build())
  .build();

await pipeline.run({ message: 'URGENT: refund dispute on order #4411' });
```

The fourth primitive is `Loop` — `Loop.repeat(agent).until(guard).times(5)`, with a mandatory budget guard. And the named patterns from the research literature ship pre-composed from the same four: `selfConsistency` · `reflection` · `debate` · `mapReduce` · `tot` · `swarm` · `llmSwarm` (a swarm whose hand-offs an LLM decides). Because every composition is a flowchart, the structure you wrote is the structure you see in the UI — and the trace spans the whole pipeline, not one agent at a time. [Designing systems of agents ↓](#-build--design-your-agent-or-system-of-agents)

---

## How — we abstract context engineering

Skills, steering, RAG, facts, memory, guardrails — every name for context does one thing: it injects into one of three LLM slots. So we abstracted the injection itself.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-light.svg">
    <img alt="agentfootprint mascot composing context flavors (Skills, Steering, Guardrails, RAG, Tool APIs, Memory) into three structured LLM slots (system, messages, tools) — the central abstraction, visualized." src="docs/assets/hero-light.svg" width="100%"/>
  </picture>
</p>
<p align="center">
  <sub><em>One primitive: <code>Injection = slot × trigger × cache</code>. Because the framework owns this point, every piece of context is <b>born tracked</b> — observability isn't wired up, it's a consequence of the abstraction. <a href="#the-model--what-we-abstract">The full model ↓</a></em></sub>
</p>

## What tracking buys you

**See it in 30 seconds** — four questions logs can't answer, each answered by code in this repo from a real run:

```text
Q: Why did the model pick refund_full instead of refund_partial?
A: margin 0.02 — ⚠ NARROW: the two tool descriptions read nearly identical
   (toolChoiceRecorder — and the catalog lint flags the pair before you ever run)

Q: Why was this loan declined?
A: decision ← [control: "DTI above the 0.43 affordability ceiling"] ← dti 0.52 ← monthlyDebt / income
   (decide() evidence + the causal slice — every hop is a real recorded edge)

Q: Which piece of context made the answer wrong?
A: CAUSAL: ablating fact 'vip-override' flipped the outcome in 3/3 seeded reruns
   (localizeContextBug — ranked proxies, counterfactual proof)

Q: Prove nobody edited this run's record.
A: verifyAuditBundle → valid: false, brokenAt: #16 — the tampered record, named
   (hash-chained audit export, offline verification)
```

And you don't have to read the trace yourself — the trace toolpack lets a debugger model do it: in one run it found a planted bug while reading **9.5% of the trace** ([guide](docs/guides/trace-debugging.md)).

And the watching costs the run nothing:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/event-loop-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/event-loop-light.svg">
    <img alt="Your agent is the event loop — animated. Left: your agent code (Context, Call LLM, Tool Calls) looping turn after turn. Right: the JS event loop drawn as two bold curved arrows with a traveling cursor and two stops — the call stack, where each stage runs as a frame and feeds four trace events (structure, data, control, emit) into the trace queue at the loop's center; and idle time, where the dispatcher flies the queued events into TRACE MEMORY and every listener (onStageAdded, onCommit, onDecision, onEmit) receives every event, one beat behind. Grey is JavaScript's own machinery, green is footprintjs, colors are your code and its trace." src="docs/assets/event-loop-light.svg" width="100%"/>
  </picture>
</p>
<p align="center">
  <sub><em>Your agent <b>is</b> the event loop: each stage feeds its trace events into a queue on the call stack; the dispatcher delivers them to your listeners in the idle beat — <b>one beat behind</b>, never on the hot path.</em></sub>
</p>

## One contextual error, walked end to end

The third question above, in full — every value below is the captured output of
[`examples/observability/05-context-bisect.ts`](examples/observability/05-context-bisect.ts)
and [`06-backtrack-trace.ts`](examples/observability/06-backtrack-trace.ts), runnable offline.

**The bug.** A refunds agent carries a poisoned customer-profile fact. It answers:

> *"Refund APPROVED: Dana Reyes holds VIP tier override status, so the 47-day-old
> order qualifies for a refund beyond the 30-day window."*

The policy says 30 days. The logs look fine — the model was *given* bad context,
and classical logging has no row for that.

**The walk.** Because context here is state, the decision backtracks like a
variable: who read it, who wrote it, who let it in, where it was born —

```text
ANSWER   "Refund APPROVED…"                                   ← the bug
READ     call-llm#40 assembled the system prompt              ← exactly what the model saw
LANDED   context#6 wrote systemPromptInjections               ← who mutated state
ALLOWED  trigger { kind: 'always' } — active every iteration  ← why it was let in
BORN     defineFact('vip-override-fact')                      ← who wrote it
```

That chain is the **provable candidate set** — everything that demonstrably reached
the call, nothing else. Influence scoring then *ranks* inside it, and counterfactual
**ablation proves**: removing `vip-override-fact` flips APPROVED → DECLINED in
**3/3 seeded reruns** (the benign fact and the lookup tool: 0/3). Scores are proxies;
only ablation makes the causal claim.

**Three interfaces, one per shape of bug** — ship-a-default, bring-your-own:

| interface | finds the culprit when it is… | confirm by |
|---|---|---|
| **influence ranking** (`scoreInfluence` + `rankingConfidence`) | **present** — orders suspects, says when it can't rank | — |
| **ablation** (`localizeContextBug`) | **present** — *remove* it, see the outcome flip | removal |
| **missing-context finder** (`findDroppedContext`) | **absent** — available but never reached the model (`available − sent`) | restoration |

The third closes a gap the first two are blind to: a key instruction truncated out of
the window has nothing to ablate, so you confirm by *restoration*. And when scoring is
too flat to trust, `rankingConfidence` returns a shortlist to confirm rather than a
confident, wrong #1. Guides: [ranking-confidence](docs/guides/ranking-confidence.md) ·
[missing-context](docs/guides/missing-context.md).

**The same walk, visual.** `toBacktrackTrace()` serializes the report into
[Story Lens](https://github.com/footprintjs/agentThinkingUI)'s `<BacktrackView>`
— the "why?" board, triggerable from any decision point (final answer, a mid-loop tool
choice, a deterministic `decide()` rule):

<img alt="The BacktrackView board: the wrong answer, the suspects with influence meters, the CAUSAL 3/3 ablation stamp on the planted fact, and the chain-of-custody rewind showing the exact system prompt the model saw with the culprit sentence highlighted." src="docs/assets/backtrack-board.png" width="100%"/>
<p align="center">
  <sub><em>The wrong answer, suspects with influence meters, the <b>CAUSAL 3/3</b> ablation stamp on the planted fact, and the rewind showing the <b>exact system prompt the model saw</b> with the culprit highlighted — recorded state, not a reconstruction. Every id is a <code>runtimeStageId</code> a debugger LLM can drill via the <a href="docs/guides/trace-debugging.md">trace toolpack</a>. <a href="https://footprintjs.github.io/agentThinkingUI/demo/backtrack.html"><b>▶ Try it live</b></a> · run <a href="examples/observability/06-backtrack-trace.ts"><code>06-backtrack-trace.ts</code></a> offline.</em></sub>
</p>

### Pick how influence is scored — then re-run without the noisy source

Influence ranking is a pluggable strategy. Two ship out of the box:
`semantic-alignment` (embeddings, the default) and `lexical-overlap` (plain word
overlap — free and deterministic). `listInfluenceStrategies()` gives a UI everything
it needs to offer a picker, and to grey out what it can't run.

Found the source you suspect? `rerunWithoutSources` runs the same scenario again without
it. It reports what changed — the answer, how often it flipped across seeded re-runs, and
(with `checkBaseline`) a causal verdict. Scores suggest; re-runs convict.

```ts
const again = await rerunWithoutSources({ report, ignore: ['social-sentiment'], runner, originalAnswer, embedder });
again.answer;              // 'HOLD …'
again.whatChanged.summary; // 'Removing sources [social-sentiment] changed the answer in 3/3 seeded re-runs …'
```

### Chat sessions that can explain themselves

`recordedChat` wraps your agent factory into a recorded conversation. Every `send()`
freezes that turn's evidence. `reason(k)` shows what influenced reply K. `rerunTurn(k,
{ ignore })` re-runs that exact turn — same recorded history, byte for byte — without a
source, and returns the same honest result `rerunWithoutSources` gives you. `fork(k,
{ fromRerun })` continues the conversation from the what-if as a new recorded session.
Branch, never rewrite.

```ts
import { recordedChat } from 'agentfootprint/observe';

const chat = recordedChat({ makeAgent });          // your factory, specs applied at construction
await chat.send('Should we BUY or HOLD?');         // recorded turn (frozen evidence)
const rerun = await chat.rerunTurn(1, {            // that turn, minus one source
  ignore: ['social-sentiment'], embedder, checkBaseline: true,
});
const fork = chat.fork(1, { fromRerun: rerun });   // continue from the what-if
```

---

## Pick your door

| 🔧 Building an agent? | 🐛 Agent misbehaving? | 🏛️ Need audit / compliance? |
|---|---|---|
| Typed agents with skills, steering, RAG, memory, guardrails — and the trace for free. | Lint your tool catalog in 5 minutes — works on **any** framework's tool list (plain JSON / MCP / OpenAI / Anthropic shapes). Then causal slices, context bisection, and the debugger-LLM toolpack. | Hash-chained, tamper-evident run records with an offline verifier — record-keeping in the EU-AI-Act shape. |
| [→ Quick start](#quick-start--runs-offline-no-api-key) · [→ Build ↓](#-build--design-your-agent-or-system-of-agents) | [→ Debug ↓](#-debug--see-what-your-agent-did) · [→ Tool-catalog lint](docs/guides/tool-catalog-lint.md) · [→ Trace debugging](docs/guides/trace-debugging.md) | [→ Audit ↓](#-audit--prove-what-happened) · [→ Security guide](docs/guides/security.md) |

---

## The model — what we abstract

You collect domain-specific data and instructions — **Skills · Steering · Guardrails · RAG · Tool APIs · Memory**, with more on the way. They all do one thing: **inject into one of three slots** (`system`, `messages`, `tools`). So we abstracted the injection itself.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/triggers-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/triggers-light.svg">
    <img alt="agentfootprint — Every LLM call has 3 fixed slots (system, messages, tools). Every flavor lands in one slot under one of 4 fixed triggers (always · rule · on-tool-return · llm-activated). Sparkle streams flow from each trigger lane down to a specific pill inside its destination slot — same slot can hold pills from different triggers (RAG via rule, Instruction via on-tool-return), and the same flavor (Skill) can land in different slots." src="docs/assets/triggers-light.svg" width="100%"/>
  </picture>
</p>

The abstraction is three rules:

1. **Three slots are fixed.** `system`, `messages`, `tools` — the LLM API surface.
2. **N flavors are open.** You declare what you have. Tomorrow's flavor (few-shot, reflection, persona, A2A handoff…) plugs in the same way.
3. **Rules decide *where* and *when*.** You provide the rules. We collect your data, fire the right one, land it in the right slot at the right iteration.

That's the whole model: `Injection = slot × trigger × cache`.

- **Slot** — which of the 3 LLM API regions the content lands in (`system` / `messages` / `tools`).
- **Trigger** — when the content fires (see below).
- **Cache** — how stable the content is across iterations. The framework places provider cache markers for you — stable content gets 80–90% cheaper prefixes.

### The 4 triggers

| Trigger | Flavor | Fires when | Illustration | Default slot |
|---|---|---|---|---|
| `always` | static | Every iteration | `.steering(defineSteering({ id, prompt: 'You are a triage agent…' }))` | `system` |
| `rule` | runtime — predicate | Your rule returns true | `.instruction(defineInstruction({ id, activeWhen: s => /price\|refund/.test(s.userQuery), prompt }))` | `system` |
| `on-tool-return` | runtime — lifecycle | After a specific tool returns | `.instruction(defineInstruction({ id, activeWhen: s => s.lastToolResult?.toolName === 'search', prompt: 'Cite source IDs.' }))` | `system` |
| `llm-activated` | runtime — agent-driven | LLM calls `read_skill('id')` | `.skill(defineSkill({ id: 'refund-policy', description, body }))` | `system` (body) + `tools` |

> [!NOTE]
> The "Illustration" column shows the shape of each flavor — the typed builder methods (`.steering` / `.instruction` / `.skill` / `.fact` / `.rag`) take an `Injection` (or `MemoryDefinition` for `.rag`) produced by the matching `defineSteering` / `defineInstruction` / `defineSkill` / `defineFact` / `defineRAG` factory. A `Skill` targets more than one slot at once: `tools` (the schemas it contributes — registered up front and visible from iteration 1 unless the Skill sets `autoActivate: 'currentSkill'`, which scopes them to the iterations where it is active) and `system` (its body — or, with `surfaceMode: 'tool-only'`, the `read_skill` result instead). The `messages` slot both projects the conversation and accepts delivery: `slot: 'messages'` (with a `role` you name) appends to the window itself, subject to what the attached provider carries inside `messages` and to a sequence rule that defers rather than reorders.

**3 slots × 4 triggers × N flavors = the entire context-engineering surface.**

---

## Why we chose this abstraction

The agent space has many credible primary abstractions:

| Framework | What it abstracts |
|---|---|
| **LangChain** | Pipelines of composable components |
| **LangGraph** | State machines of nodes and edges |
| **CrewAI · AutoGen** | Crews of role-playing agents |
| **Mastra · Genkit · Pydantic AI** | Typed full-stack bundles |
| **DSPy** | Compiled prompts |
| **Inngest AgentKit** | Durable workflows |

We didn't have to choose between them.

agentfootprint is built on **footprintjs** — the flowchart pattern for backend code. footprintjs gives us every one of those abstractions out of the box:

| Capability | What footprintjs hands us |
|---|---|
| Composition | `Sequence` · `Parallel` · `Conditional` · `Loop` |
| State machines | The ReAct loop *is* a flowchart |
| Multi-agent crews | Compose Agents through control flow — no special class needed |
| Durable workflows | `pauseHere()` plus JSON-portable `resume()` |
| Typed observation | 60+ events for free, because the framework owns the loop |

So we used the budget those abstractions would have cost us to invest deeply in something they all leave to the developer: **the injection loop.**

> [!IMPORTANT]
> **We abstract context engineering — and hand back the trace.**
> Live to develop · offline to monitor · detailed to improve.

---

## 🔧 Build — design your agent or system of agents

Two scales — same alphabet. Four control flows are the entire vocabulary.

<table>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/sequence-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/sequence-light.svg">
    <img alt="Sequence — linear chain A → B → C." src="docs/assets/sequence-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Sequence } from 'agentfootprint';

const flow = Sequence.create()
  .step('a', stageA)
  .step('b', stageB)
  .step('c', stageC)
  .build();
```

</td>
</tr>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/parallel-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/parallel-light.svg">
    <img alt="Parallel — fan-out then fan-in across N agents." src="docs/assets/parallel-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Parallel } from 'agentfootprint';

const fan = Parallel.create()
  .branch('web', searchWeb)
  .branch('docs', searchDocs)
  .mergeWithFn(synthesizer)
  .build();
```

</td>
</tr>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/conditional-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/conditional-light.svg">
    <img alt="Conditional — diamond gate routes to one of N branches based on a predicate." src="docs/assets/conditional-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Conditional } from 'agentfootprint';

const router = Conditional.create()
  .when('billing', s => /bill|invoice|refund/.test(s.message), billingAgent)
  .when('tech',    s => /error|bug|crash/.test(s.message),     techAgent)
  .otherwise('default', defaultAgent)
  .build();
```

</td>
</tr>
<tr>
<td width="50%" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/loop-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/loop-light.svg">
    <img alt="Loop — body cycles back from end to start until a condition is met." src="docs/assets/loop-light.svg" width="100%"/>
  </picture>
</td>
<td width="50%">

```typescript
import { Loop } from 'agentfootprint';

const reflexion = Loop.create()
  .repeat(thinkAgent)
  .until(({ latestOutput }) => latestOutput.includes('DONE'))
  .build();
```

</td>
</tr>
</table>

### Inside one agent — Dynamic vs Classic ReAct

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dynamic-vs-classic-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dynamic-vs-classic-light.svg">
    <img alt="Classic ReAct vs Dynamic ReAct loop topology — same 5 stages (SystemPrompt, Messages, Tools, CallLLM, Route → ExecuteTools/Finalize), but the loop edge differs: Classic returns to CallLLM only (slots frozen at 12 tools every iteration), Dynamic returns to SystemPrompt (slots recompose, tools shrink from 1 to 5 as skills activate)." src="docs/assets/dynamic-vs-classic-light.svg" width="100%"/>
  </picture>
</p>
<p align="center">
  <sub><em>Same five stages; only the loop edge differs. Classic returns to <code>CallLLM</code> with slots frozen; Dynamic (agentfootprint) returns to <code>SystemPrompt</code>, so injections recompose the next prompt — also the prerequisite for per-iteration caching.</em></sub>
</p>

| Iteration | Classic ReAct | Dynamic ReAct (agentfootprint) |
|---|---|---|
| 1 | 12 tools shown | **1 tool** (`read_skill`) |
| 2 | 12 tools shown | **5 tools** (skill activated) |
| 3 | 12 tools shown | 5 tools |

> 📖 [Dynamic ReAct guide](https://footprintjs.github.io/agentfootprint/docs/build/dynamic-react/) · [Key concepts](https://footprintjs.github.io/agentfootprint/docs/getting-started/key-concepts/)

### Multi-agent — compose with the alphabet

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/compose-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/compose-light.svg">
    <img alt="A custom research agent built from the same 4 control flows: input flows into a Conditional gate (plan more research?), which fans out to a Parallel block (search_web, search_docs, search_kb), then chains into a Sequence (synthesize → critique), and a Loop arrow returns from the end back to the Conditional gate so the agent iterates until satisfied. Formula: Loop( Conditional(plan?) → Parallel(search_web, search_docs, search_kb) → Sequence(synth → critique) )." src="docs/assets/compose-light.svg" width="100%"/>
  </picture>
</p>

Pick the flows that match your problem. Chain them. **That's your Agentic Application.**

```typescript
const research = Loop.create()
  .repeat(Sequence.create().step('plan', plan).step('search', searchAll).build())
  .until(({ iteration, latestOutput }) => iteration >= 3 || latestOutput.includes('DONE'))
  .build();
```

### Named patterns — also compositions of the same 4

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/patterns-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/patterns-light.svg">
    <img alt="6 named multi-agent patterns reduce to compositions of the same 4 control flows: Swarm = Loop(Parallel(Agent×N) → merge); Tree-of-Thoughts = Loop(Parallel(Agent×N) → Conditional(score)); Reflexion = Loop(Agent → Conditional(critique) → Agent); Debate = Parallel(Agent_pro, Agent_con) → Agent_judge; Router = Conditional → Agent_A | Agent_B | Agent_C; Hierarchical = Agent_planner → Sequence(Agent_worker×N) → synth." src="docs/assets/patterns-light.svg" width="100%"/>
  </picture>
</p>

The patterns the field knows reduce to the same alphabet:

| Pattern | Composition |
|---|---|
| **Swarm** | `Loop( Parallel( Agent×N ) → merge )` |
| **Tree-of-Thoughts** | `Loop( Parallel( Agent×N ) → Conditional(score) )` |
| **Reflexion** | `Loop( Agent → Conditional(critique) → Agent )` |
| **Debate** | `Parallel( Agent_pro, Agent_con ) → Agent_judge` |
| **Router** | `Conditional → Agent_A \| Agent_B \| Agent_C` |
| **Hierarchical** | `Agent_planner → Sequence( Agent_worker×N ) → synth` |

Same trick as the injection model: instead of N libraries for N patterns, we found the M building blocks all N patterns are made of.

> 📖 Compare: [hand-rolled vs declarative](https://footprintjs.github.io/agentfootprint/docs/getting-started/why/) · [migration from LangChain / CrewAI / LangGraph](https://footprintjs.github.io/agentfootprint/docs/getting-started/vs/)

### Check in with the receipts — human-in-the-loop consent for consequential actions

OpenWorker-class agents check in; agentfootprint checks in **with the receipts.** A tool declares `checkIn: 'always'` (or a `(args) => boolean` predicate). When it trips, the run pauses **before** the tool executes and hands back an evidence pack: `willDo` (plain-words claim), `read` (context the run consumed), `drivers` (which context drove the choice, ranked, zero LLM calls), and a compact `trail`. A human answers `checkInApproved({ by })` / `checkInDeclined({ by, note })`; on approve the tool runs, on decline the model sees the note and adapts.

```ts
const refund = defineTool({
  name: 'issue_refund', description: 'Issue a refund',
  inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
  checkIn: (args) => args.amount > 1000,     // ask a human only for big refunds
  execute: ({ amount }) => `refunded ${amount}`,
});
const out = await agent.run({ message: 'refund 5000' });
if (isCheckInPause(out)) {                    // distinct from a plain askHuman pause
  showToHuman(out.checkIn.evidence);          // the receipts
  await agent.resume(out.checkpoint, checkInApproved({ by: 'alice@ops' }));
}
```

It rides the same JSON checkpoint as pause/resume — the ask and the decision can be servers and days apart — and lands `checkin.request` / `checkin.decision` as typed events (`CheckInRecorder` captures the audit trail). A tool without `checkIn` is byte-identical. Permission (policy) still runs first — check-in is **consent**, not policy.

Run the flagship demo — an AI coworker that drafts a weekly status doc and checks in before posting it (deterministic $0 mock, watch it adapt on decline):

```bash
npm run example examples/features/34-checkin-coworker.ts -- --decline
```

See the [Check-in guide](https://footprintjs.github.io/agentfootprint/docs/monitor/checkin/).

### Act — everything your agent does about its own loop, in one block

**Tools do the work. Act decides about the work. Watch remembers both — and nothing can act without being watched.**

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/loop-moments-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/loop-moments-light.svg">
    <img alt="One agent turn drawn as a circle. The message enters through the INPUT gate; the loop runs clockwise past the WINDOW gate (what the live context keeps), the context slots and the model call, the BEFORE-TOOL gate (every call, before dispatch), the tool actually running, the AFTER-TOOL gate (every result, before the model reads it) and the end of the iteration; the answer leaves through the OUTPUT gate. Five amber gates are the moments .act() can change; purple watch-dots sit at every moment, including the ones with no gate, because watch attends all of them and cannot be switched off." src="docs/assets/loop-moments-light.svg" width="100%"/>
  </picture>
</p>

```ts
const agent = Agent.create({ provider, model })
  .act({
    input:      [scrubSSNs],                            // the message, before the run commits it
    beforeTool: [refundCeiling, fourEyes],              // every call, before it is dispatched
    afterTool:  [stripPII],                             // every result, before the model reads it
    window:     slidingWindow({ keepRecentTurns: 12 }), // what the live window keeps
    output:     [noCodenames],                          // the answer, before the caller gets it
  })
  .build();
```

Five keys, one per moment, in the order the loop reaches them — so autocomplete on an empty `{}` teaches the loop. Every rule answers `allow()`, `allow(value, why)` or `deny(reason)` (and `ask({ question })` where a person can still change the outcome), **and none of them can answer for the tool**: the outcome union has no result arm, so what the model finally reads is the real tool's output or a refusal. Every decision files a ledger row stamped with its `moment`.

It is pure sugar over the five individual doors, pinned byte-equivalent per key — and the bundle's keys are locked against `LoopMoment` at compile time, so a sixth moment cannot ship without a key for it.

```bash
npm run example examples/features/38-act.ts
```

See [The moments of the loop](https://footprintjs.github.io/agentfootprint/docs/build/loop-moments/).

### Watch — who is looking while it does

`.act()` says what the agent may do. `.watch()` says who is looking while it does it. Observers handed to the builder are attached before `build()` returns, so there is no window where the agent has run and nobody was watching:

```ts
const routes  = routeRecorder();
const choices = toolChoiceRecorder({ embedder: staticEmbedder() });

const agent = Agent.create({ provider, model })
  .watch(routes, choices)     // build-time — sees the very first run
  .act({ beforeTool: [refundCeiling] })
  .build();

await agent.run({ message: 'refund order 4471' });

console.log(await choices.getFlagged());   // calls where the tool choice was a near-tie
```

Variadic, because observers come in sets. It returns the builder — the runtime door is still `agent.attach(observer)`, which returns an `Unsubscribe` you own and call when the observer's life ends. Same mechanism underneath, so mixing them is fine and order is preserved.

There is deliberately no list of "watch moments" to go with `.act()`'s five. A rule has to be *told* where it may speak, so that list is closed and compiler-pinned; an observer attends the whole stream, and any list we published would be a vocabulary we then had to keep true.

*(`.recorder()` was the same door under its old, internals-flavoured name. It was removed in 9.0.0 and now throws a sentence pointing here — see [9.0.0](./CHANGELOG.md).)*

---

## 🐛 Debug — see what your agent did

<p align="center">
  <img src="docs/assets/lens-run.png" alt="A real agent run in Why Lens: the conversation (with live PII redaction), the executed path lit on the merge-tree flowchart, the WHAT-HAPPENED timeline of every iteration/context/LLM turn/route, run stats, and the step inspector — all generated from the run's own trace." width="100%">
</p>
<p align="center">
  <sub>One real run, fully explained — <a href="https://github.com/footprintjs/agentfootprint-lens"><b>Why Lens</b></a> (<code>npm i agentfootprint-lens</code>): conversation · executed path · per-step timeline · stats, every pixel from the trace.</sub>
</p>

Because we own the loop, every decision and execution is captured during traversal — not bolted on. The default capture is the **causal trace**: every stage, read, write, and decision evidence as a JSON-portable, scrubbable, queryable, exportable artifact — and every LLM call backtracks to four typed answers: **what** was injected, **who** triggered it (which rule), **when** it fired, **how** it landed (slot · position · cache). Beyond the default, wire custom recorders for cost, latency, or quality scoring — any observation hook fires on the same stream.

The same trace serves three downstream consumers — no extra instrumentation:

| Consumer | What the trace gives you |
|---|---|
| **Audit / compliance** | Six months later, *"why was loan #42 rejected?"* answers from the chain (`creditScore=580 < 620 ∧ dti=0.6 > 0.43 → riskTier=high → REJECTED`) — no LLM call. GDPR Art. 22 / ECOA / EU AI Act adverse-action notices write themselves from the captured decision evidence. |
| **Cheap-model triage** | A Sonnet trace is good *input* for Haiku to answer follow-ups: ~200 tokens ($0.25/1M) vs ~2,500 at a reasoning model ($15/1M). Memoized thinking — no agent rerun. |
| **Training data** | Every successful chain is a labeled trajectory; SFT pairs fall out of the snapshot's history field. (The export wrapper, DPO, and process-RL need extra collection layers — [roadmap](https://github.com/footprintjs/agentfootprint/issues).) |

Four views, one trace — pick by question:

| View | Shows | When to use |
|---|---|---|
| **Story Lens** (the hero up top) | The run replayed as an animated, scrubbable story — the brain, the tools, the reasoning | Show anyone *what the agent did* |
| **BacktrackView** ([the board above](#one-contextual-error-walked-end-to-end)) | A decision walked backwards — suspects, influence meters, ablation stamps, custody rewind | Answer *why it decided that* |
| **Why Lens** | Agent-centric — User/Agent[3 slots]/Tool flowchart with iteration scrubber and round commentary | Live debugging, "what did the agent see at step 5?" |
| **Explainable Trace** | Structural — subflow tree, full flowchart, memory inspector, per-stage execution timeline | Architecture review, root-cause analysis |

And two **conversational** doors over the same evidence — ask instead of look:

```ts
// dedicated: a cheap model debugs an expensive run by id — pays for what it opens
const debuggerAi = traceDebugAgent({ artifacts, provider: anthropic(), model: 'claude-haiku-4-5' });
await debuggerAi.run({ message: 'Why was loan APP-7 approved?' });

// in-conversation: the agent answers "why did you…?" from its OWN previous turn
Agent.create({ provider, model }).tool(lookupOrder)
  .selfExplain({ delegate: { provider: anthropic(), model: 'claude-haiku-4-5' } })
  .build();
```

`.selfExplain()` mounts one skill: the catalog stays clean until the LLM activates
it, evidence binds only to **completed** runs (never in-flight), and `delegate`
answers at the cheap model's price inside the expensive conversation.
[Guide](docs/guides/trace-debugging.md) · examples
[`07`](examples/observability/07-trace-debug-agent.ts) ·
[`08`](examples/observability/08-self-explain.ts) · the doors walk the
[**same evidence the board visualizes ▶**](https://footprintjs.github.io/agentThinkingUI/demo/backtrack.html).

> 📖 Powered by [footprintjs `causalChain()`](https://footprintjs.github.io/footPrint/blog/backward-causal-chain/) — backward thin-slicing on the commit log. [Causal memory deep dive](https://footprintjs.github.io/agentfootprint/docs/debug/causal-deep-dive/) · [Explainability & compliance](https://footprintjs.github.io/footPrint/blog/explainability-compliance/)

**One recording. Two lenses. Three consumers. Zero extra instrumentation.**

### Observers stay off the hot path

By default every `agent.on()` listener runs synchronously inside the producing
statement. One option moves observation off the hot path:

```ts
Agent.create({ provider, model, observerDelivery: 'deferred' }) // default 'inline'
// serverless / shutdown: settle async listener work before the freeze
await agent.drainObservers({ timeoutMs: 5_000 });
```

Events are captured into a bounded queue (≈ microseconds on the hot path) and
delivered one beat behind — same typed events, same order, zero loss, a throwing
listener can't kill the run, and per-listener stats land on
`getLastSnapshot()?.observerStats` to name the hog. Terminal boundaries (resolve,
crash, pause) drain synchronously first, so checkpoints are always complete.
Measured: −8% wall on a 50-iteration agent with a deliberately slow listener
([example 21](examples/features/21-deferred-observers.ts)).

> 📖 Full semantics (capture policies, backpressure, overflow):
> [deferred-observers guide](https://github.com/footprintjs/footPrint/blob/main/docs/guides/observers-deferred.md)

### Lint your tool catalog — before the model picks the wrong twin

Tool routing is an LLM decision driven by names + descriptions — so lint the
catalog like code and gate it in CI. **Zero stack buy-in**: works on any
OpenAI / Anthropic / MCP / plain tool list, no agentfootprint runtime needed.

```bash
npx agentfootprint-lint-tools tools.json --threshold 0.94 --strict
```

```
✗ CONFUSABLE 0.9445  get_fcns_database <> influx_get_fcns_database
    hint: names differ only by 'influx' — make the descriptions say WHEN to choose each
~ warn  [enum-in-prose] influx_get_port_ranking.metric
    suggest: "enum": ["avg_iops","peak_iops","mbps"]
```

Pairwise confusability over what the model reads (embedder pluggable,
content-hash cached) plus a pluggable structural rule pack
(missing/short descriptions, says-WHAT-not-WHEN, enums hiding in prose,
undocumented optional params). The runtime counterpart, `toolChoiceRecorder`
(`agentfootprint/observe`), scores each live LLM call's tool choice against
the same geometry and flags narrow margins and proxy disagreements — lazily,
off the hot path.

agentfootprint owns the *detection* — the scores, the ties, the recorded
margins; you own the *policy* — the threshold, the embedder, the rewrite. We
map; you decide.

> 📖 **[Tool-catalog lint guide](docs/guides/tool-catalog-lint.md)** — 5 minutes
> from a tools.json to a gated CI check ·
> [`examples/observability/02`](examples/observability/02-lint-confusable-catalog.ts) ·
> [`03`](examples/observability/03-lint-fix-and-pass.ts) ·
> [`04`](examples/observability/04-tool-choice-margins.ts)

---

## 🏛️ Audit — prove what happened

Answering *"why was the loan rejected?"* from captured evidence is the [debug door above](#-debug--see-what-your-agent-did). The audit door adds the integrity layer: prove the **record itself** hasn't been edited since capture. `auditExport()` hash-chains every typed event — decisions, tool calls, validation rejections, permission verdicts, costs — into an append-only bundle (EU AI Act Art. 12 record-keeping shape); `verifyAuditBundle()` re-checks it **offline** — no agent, no LLM — and names the exact record any tamper broke.

```ts
import { auditExport, verifyAuditBundle } from 'agentfootprint/observe';

const audit = auditExport({ agent: 'ledger-auditor' });
const stop = agent.enable.observability({ strategy: audit });
await agent.run({ message: 'audit account ACCT-1142' });
stop();

const bundle = audit.bundle();           // plain JSON — store anywhere
verifyAuditBundle(bundle);               // { valid: true, recordsChecked: 50 }
// flip one byte anywhere → { valid: false, brokenAt: 13, reason: 'hash mismatch — …' }
```

Payloads are PII-bounded by default (tool args as key names, results as a type, content as `[N chars]` markers). And it's honest about its limits: tamper-**evident**, not tamper-proof — for non-repudiation, anchor both chain ends in external storage (WORM store, signed log).

> 📖 **[Tamper-evident audit guide](docs/guides/security.md#tamper-evident-audit-export--auditexport--verifyauditbundle)** ·
> [`examples/features/19-audit-export.ts`](examples/features/19-audit-export.ts) — capture → verify → tamper → drain ·
> [`20-regulated-decisioning.ts`](examples/features/20-regulated-decisioning.ts) — an offline auditor reconstructs a loan decline from persisted files, both chain ends anchored

---

## Mocks first, production second

Build the entire app against in-memory mocks with **zero API cost**, then swap real infrastructure one boundary at a time.

| Boundary | Dev | Prod |
|---|---|---|
| LLM provider | `mock(...)` | `ollama('<model>')` free · `anthropic()` · `openai()` · `bedrock()` |
| Memory store | `InMemoryStore` | `RedisStore` · `AgentCoreStore` |
| MCP | `mockMcpClient(...)` | `mcpClient({ transport })` |
| Cache strategy | `NoOpCacheStrategy` | auto-selected per provider |

The flowchart, recorders, and tests don't change between dev and prod.

---

## What ships today

<details>
<summary><b>Full capability list</b> — core · 7 providers · memory + adapters · operability · debugging &amp; compliance · tooling</summary>

<br/>

**Core**
- 2 primitives — `LLMCall`, `Agent` (the ReAct loop)
- 4 control flows — `Sequence`, `Parallel`, `Conditional`, `Loop` (plus `workflow()`, the same sequence with every hand-off type-checked by the compiler, and `graph()`, a fixed DAG whose independent nodes run concurrently)
- 1 Injection primitive — `defineSkill` / `defineSteering` / `defineInstruction` / `defineFact`
- 1 reliability gate — `.reliability({ preCheck, postDecide, providers, circuitBreaker, fallback })`
- 1 tool dispatch primitive — `ToolProvider` (sync OR async) — `staticTools` · `gatedTools` · `skillScopedTools` · or a custom `ToolProvider` that discovers over hubs / MCP / per-tenant catalogs

**LLM providers** (7)

| Factory | Use for |
|---|---|
| `anthropic` | Claude (Sonnet, Opus, Haiku) via `@anthropic-ai/sdk` |
| `openai` | GPT-4o, GPT-4-turbo via `openai` SDK |
| `bedrock` | Claude / Titan / Mistral via AWS Bedrock runtime |
| `ollama` | Local models, over Ollama's native API — no SDK, no key, real token counts, refusals that name `ollama serve` / `ollama pull` · `openai({ baseURL })` reaches llama.cpp, vLLM, and any other OpenAI-compatible endpoint |
| `browserAnthropic` | Browser-side Claude calls (no proxy server) |
| `browserOpenai` | Browser-side OpenAI calls (no proxy server) |
| `mock` | Deterministic dev/test (zero API cost) |

**Memory + adapters**
- Memory factory — 4 types (`episodic` / `semantic` / `narrative` / `causal`) × 7 strategies (`window` / `budget` / `summarize` / `topK` / `extract` / `decay` / `hybrid`)
- Memory stores — `InMemoryStore`, `RedisStore` (peer-dep `ioredis`), `AgentCoreStore` (peer-dep AWS SDK)
- RAG · MCP adapters — `mockMcpClient(...)` / `mcpClient({ transport })`

**Operability**
- Provider-agnostic prompt caching — declarative per-injection, per-iteration marker recomputation
- Human-in-the-loop pause / resume — a tool calls `pauseHere(...)` (or `askHuman(...)`); `isPaused(result)` hands you a JSON-serializable checkpoint, and `agent.resume(checkpoint, input)` continues hours later on a different server
- Resilience primitives — `withRetry`, `withFallback`, `withCircuitBreaker`, `.outputFallback`, `agent.resumeOnError`
- 60+ typed observability events — `agent` · `composition` · `context` · `stream` · `tools` · `skill` · `memory` · `cache` · `cost` · `permission` · `eval` · `embedding` · `pause` · `error` · `fallback` · `resilience` · `reliability` · `risk`

**Debugging & compliance** (`agentfootprint/observe`)
- Tool-catalog lint — `npx agentfootprint-lint-tools` (any framework's tool list) + runtime `toolChoiceRecorder` margins
- Contextual-bug localizer — `localizeContextBug` (causal slice → influence ranking → counterfactual ablation) + `bisectCulprits`
- `toBacktrackTrace` — render any decision as the BacktrackView "why?" board
- Trace toolpack — 10 bounded, LLM-callable tools so a debugger model walks the trace by id, including `inspect_tool_run`: the descent INTO a tool call, when the tool kept its own record (`flowchartAsTool({ keepRecord: true })`)
- `traceDebugAgent` (dedicated debugger session) · `.selfExplain()` (in-conversation why-questions, skill-gated, with a cheap-model `delegate` switch)
- OTel GenAI span export · hash-chained tamper-evident audit bundles with an offline verifier

**Tooling**
- **Story Lens** — animated run player + BacktrackView why-board (separate `agentthinkingui` package)
- **Why Lens** · **Explainable Trace** — two visual replays of the causal trace (separate `agentfootprint-lens` package)
- AI-coding-tool support — Claude Code · Cursor · Windsurf · Cline · Kiro · Copilot

</details>

> 📖 [Agent API reference](https://footprintjs.github.io/agentfootprint/docs/api/classes/Agent/) · [CHANGELOG](./CHANGELOG.md)

---

## Where to next

| If you are... | Go here |
|---|---|
| New to agents | [5-minute quick start](https://footprintjs.github.io/agentfootprint/docs/getting-started/quick-start/) |
| Coming from LangChain / CrewAI / LangGraph | [Migration guide](https://footprintjs.github.io/agentfootprint/docs/getting-started/vs/) |
| Architecting an enterprise rollout | [Production guide](https://footprintjs.github.io/agentfootprint/docs/monitor/deployment/) |
| Doing due diligence | [Architecture overview](https://footprintjs.github.io/agentfootprint/docs/reference/dependency-graph/) |
| Researcher / academic background | [Citations & prior art](https://footprintjs.github.io/agentfootprint/docs/reference/citations/) |
| Curious about design | [Inspiration docs](https://footprintjs.github.io/agentfootprint/docs/reference/inspiration/) |

Or jump into the [examples gallery](https://github.com/footprintjs/agentfootprint/tree/main/examples) — every example is also an end-to-end CI test.

---

## Tree-shakeable & ESM-first

Import one thing, ship one thing. agentfootprint is built so your bundle grows only with what you actually use:

- **Dual build, true ESM.** Ships CommonJS (`require`) **and** real ECMAScript Modules (`import`) with TypeScript types. The ESM build is `type:module` with explicit `.js` import extensions, so it loads as true ESM under Node, Vite, Next, Deno, and Bun — no shims.
- **Per-file modules + honest `sideEffects`.** The dist is emitted file-by-file (never pre-bundled), so bundlers drop every export you don't touch. A small `import { defineTool }` doesn't pull in the Agent runtime, injection engine, memory stores, or LLM providers.
- **Ten doors, named for what you're doing.** `agentfootprint` · `/providers` (plug in a backend) · `/memory` (state that outlives a turn) · `/observe` (everything that watches) · `/context` (how context gets assembled) · `/resilience` (when the call fails) · `/security` (who may do what) · `/hosting` (behind a wire) · `/events` (the typed wire vocabulary) · `/cache` (prompt caching). 8.0.0 consolidated 26 internals-named subpaths into these; every old path still resolves for all of 8.x.
- **Lazy peer-deps.** Heavyweight integrations load their SDK **only when you instantiate them** — importing agentfootprint never bundles `@anthropic-ai/sdk`, `ioredis`, the AWS SDKs, or the MCP SDK unless you actually use that adapter.

**Proven, not promised.** A CI smoke test bundles a minimal `import { defineTool }` and asserts the Agent runtime, injection engine, memory stores, and providers are pruned; a second test loads the main barrel and every subpath as true ESM and verifies the lazy-adapter loader works under ESM (`createRequire`, not a bare `require`). See [`test/esm-packaging.test.ts`](test/esm-packaging.test.ts).

---

## Built on

[footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code. agentfootprint's decision-evidence capture, narrative recording, and time-travel checkpointing are footprintjs primitives at the runtime layer.

You don't need to learn footprintjs to use agentfootprint — but if you want to build your own primitives at this depth, [start there](https://footprintjs.github.io/footPrint/).

---

## Citing

agentfootprint is part of a research program on making software systems explain themselves — every run records *why* it did what it did, as a causal trace. Researching agent transparency, observability, or explainable AI? The [ecosystem map](https://footprintjs.github.io/) is a good starting point.

If you use agentfootprint in academic work, please cite it (or use the "Cite this repository" button on GitHub):

```bibtex
@software{anbalagan_agentfootprint,
  author  = {Anbalagan, Sanjay Krishna},
  title   = {agentfootprint: the explainable AI agent framework},
  url     = {https://github.com/footprintjs/agentfootprint},
  license = {MIT},
  year    = {2025}
}
```

---

## License

[MIT](./LICENSE) © [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)
