

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

For production, import a real provider from `agentfootprint/providers` and swap it in — `anthropic(...)` / `openai(...)` / `bedrock(...)` / `gemini(...)` / `ollama(...)`. Only the import line changes; the agent code stays the same. (The vendor-SDK providers live on the `agentfootprint/providers` subpath so the main `agentfootprint` barrel stays free of optional peer-dep requires; `mock`, `browserAnthropic`, and `browserOpenai` are on the main barrel.)

**No cloud account?** `ollama('llama3.2')` from `agentfootprint/providers` runs the same agent against a local model for $0 — the free rung between the mock and the bill. Full recipes: [Ollama](https://agentfootprint.dev/docs/build/ollama/) · [OpenAI-compatible endpoints](https://agentfootprint.dev/docs/build/openai/#openai-compatible-endpoints-ollama-llamacpp-vllm-together-groq-lm-studio).

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
  <sub><em>One primitive: <code>Injection = slot × trigger × cache</code>. Because the framework owns this point, every piece of context is <b>born tracked</b> — observability isn't wired up, it's a consequence of the abstraction. <a href="#the-4-triggers">The 4 triggers ↓</a></em></sub>
</p>

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

**3 slots × 4 triggers × N flavors = the entire context-engineering surface.**

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

And you don't have to read the trace yourself — the trace toolpack lets a debugger model do it: in one run it found a planted bug while reading **9.5% of the trace** ([self-explain](https://agentfootprint.dev/docs/debug/self-explain/)). The watching costs the run nothing: recorders run one beat behind the agent, never on its hot path.

## Pick your door

| 🔧 Building an agent? | 🐛 Agent misbehaving? | 🏛️ Need audit / compliance? |
|---|---|---|
| Typed agents with skills, steering, RAG, memory, guardrails — and the trace for free. | Lint your tool catalog in 5 minutes — works on **any** framework's tool list. Then causal slices, context bisection, and the debugger-LLM toolpack. | Hash-chained, tamper-evident run records with an offline verifier — record-keeping in the EU-AI-Act shape. |
| [→ Quick start](https://agentfootprint.dev/docs/getting-started/quick-start/) · [→ Build an agent](https://agentfootprint.dev/docs/build/agent/) | [→ Debug](https://agentfootprint.dev/docs/debug/debug/) · [→ Tool-catalog lint](https://agentfootprint.dev/docs/debug/tool-catalog-lint/) · [→ Self-explain](https://agentfootprint.dev/docs/debug/self-explain/) | [→ Exporters & audit bundles](https://agentfootprint.dev/docs/monitor/exporters/) · [→ Security](https://agentfootprint.dev/docs/monitor/security/) |

## Mocks first, production second

Build the entire app against in-memory mocks with **zero API cost**, then swap real infrastructure one boundary at a time.

| Boundary | Dev | Prod |
|---|---|---|
| LLM provider | `mock(...)` | `ollama('<model>')` free · `anthropic()` · `openai()` · `bedrock()` |
| Memory store | `InMemoryStore` | `RedisStore` · `AgentCoreStore` |
| MCP | `mockMcpClient(...)` | `mcpClient({ transport })` |
| Cache strategy | `NoOpCacheStrategy` | auto-selected per provider |

The flowchart, recorders, and tests don't change between dev and prod.

## Building with an AI coding assistant

agentfootprint is written to be used — and maintained — by coding agents.

- **Teach your assistant the API:** `npx agentfootprint-setup` installs the agentfootprint skill for Claude Code (and rule files for Cursor, Copilot, Windsurf, Cline, Kiro). It loads only when the task is about agentfootprint.
- **Before building something, search [CAPABILITIES.md](CAPABILITIES.md)** — an index of what already ships, keyed by what *you* would call it. It is in the npm package too.
- **Every example runs:** [`examples/`](examples/) holds 160+ runnable programs, each executed end to end in CI against mock providers.

## Where to next

| If you are... | Go here |
|---|---|
| New to agents | [5-minute quick start](https://agentfootprint.dev/docs/getting-started/quick-start/) |
| Coming from LangChain / CrewAI / LangGraph | [Migration guide](https://agentfootprint.dev/docs/getting-started/vs/) |
| Architecting an enterprise rollout | [Production guide](https://agentfootprint.dev/docs/monitor/deployment/) |
| Doing due diligence | [Architecture overview](https://agentfootprint.dev/docs/reference/dependency-graph/) |
| Researcher / academic background | [Citations & prior art](https://agentfootprint.dev/docs/reference/citations/) |
| Curious about design | [Inspiration docs](https://agentfootprint.dev/docs/reference/inspiration/) |

Or jump into the [examples gallery](https://github.com/footprintjs/agentfootprint/tree/main/examples) — every example is also an end-to-end CI test.

## Tree-shakeable & ESM-first

- **Dual build, true ESM** — CommonJS and real ES modules with TypeScript types; loads natively under Node, Vite, Next, Deno and Bun.
- **Per-file modules, honest `sideEffects`** — `import { defineTool }` doesn't pull in the Agent runtime, memory stores or providers.
- **Entry points named for what you're doing** — `agentfootprint` plus `/providers`, `/memory`, `/rag`, `/observe`, `/context`, `/resilience`, `/security`, `/hosting`, `/events`, `/cache` and a few more; `package.json` `exports` is the complete list.
- **Lazy peer-deps** — vendor SDKs (Anthropic, AWS, Redis, MCP…) load only when you instantiate that adapter, and optional families like the self-explain toolpack load only when enabled.

Proven by tests, not promised: [`test/esm-packaging.test.ts`](test/esm-packaging.test.ts) and [`test/lib/trace-toolpack/browserGraph.test.ts`](test/lib/trace-toolpack/browserGraph.test.ts).

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
