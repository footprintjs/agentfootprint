# Examples

Runnable examples for [agentfootprint](https://github.com/footprintjs/agentfootprint). Every file is self-contained — `npx tsx examples/<path>` and you'll see output.

## Where to start

1. **[concepts/01-llm-call.ts](concepts/01-llm-call.ts)** — your first agentfootprint program (single LLM call, no tools, no loop).
2. **[concepts/02-agent.ts](concepts/02-agent.ts)** — same shape + a tool. ReAct loop in 30 lines.
3. Walk the rest of [concepts/](concepts/) in order — 7 files, each adds one capability over the last.
4. Then [patterns/](patterns/) for named compositions, [providers/](providers/) for prompt/message/tool strategy customization, etc.

## Folder guide

| Folder | What's in it |
|---|---|
| **[concepts/](concepts/)** | The 7-concept ladder (LLMCall → Agent → RAG → FlowChart → Parallel → Conditional → Swarm) |
| **[patterns/](patterns/)** | `AgentPattern` (Regular vs Dynamic) + the 4 composition factories (planExecute, reflexion, treeOfThoughts, mapReduce) |
| **[providers/](providers/)** | The 3 strategy slots — PromptProvider, MessageStrategy, ToolProvider |
| **[runtime-features/](runtime-features/)** | Streaming, instructions, memory, parallel-tools, custom routing |
| **[observability/](observability/)** | Recorders, ExplainRecorder grounding, OTel-style metrics, exportTrace |
| **[security/](security/)** | Permission-gated tools |
| **[resilience/](resilience/)** | withRetry / withFallback / withCircuitBreaker, fallbackProvider |
| **[advanced/](advanced/)** | Low-level `agentLoop()` — what Agent / Swarm / RAG wrap internally |
| **[integrations/](integrations/)** | Multi-feature, end-to-end recipes |

## Running an example

```bash
# From the agentfootprint repo root:
npx tsx examples/concepts/02-agent.ts
```

All examples ship with a `mock()` provider by default, so they run with **zero API keys and zero network calls** — fast, deterministic, free.

## Using a real provider

Every example exports a `run(input, provider?)` function. Pass your own provider to swap from the mock to a real LLM:

```typescript
import { run } from 'agentfootprint/examples/concepts/02-agent';
import { createProvider, anthropic } from 'agentfootprint/providers';

const result = await run(
  'What is 17 + 25?',
  createProvider(anthropic('claude-sonnet-4-20250514')),
);
console.log(result.content);
```

The flowchart structure is identical to the mock run — only the LLM's actual content differs. The playground (when wired) uses this pattern to swap providers based on the user's UI selection.

## Contract & design

See **[DESIGN.md](DESIGN.md)** for the structural rules every example follows, the playground integration contract, and how to add a new example.
