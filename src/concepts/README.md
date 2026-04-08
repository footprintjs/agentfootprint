# concepts/

The 6 agent patterns — builders + runners.

## Single LLM (one agent, one task)

| Pattern | Builder | When to use |
|---------|---------|-------------|
| **LLM Call** | `LLMCall.create({ provider })` | Single prompt → single response. No tools, no loop. |
| **Agent (Tool Use)** | `Agent.create({ provider })` | LLM + tools in a ReAct (Reason + Act) loop. Decides when to call tools and when to stop. |
| **RAG (Retrieval-Augmented Generation)** | `RAG.create({ provider, retriever })` | LLM + knowledge retrieval. Relevant chunks injected into the prompt before the LLM call. |

## Multi-Agent (compose agents)

| Pattern | Builder | When to use |
|---------|---------|-------------|
| **Sequential** | `FlowChart.create()` | Multiple agents chained in order. Output of one feeds the next. |
| **Parallel** | `Parallel.create({ provider })` | Multiple agents run simultaneously. Results merged by LLM or custom function. |
| **Routing** | `Swarm.create({ provider })` | Orchestrator picks ONE specialist per request. Dynamic delegation. |

## How they compose

These are primitives, not prescriptions. Compose freely:

```typescript
// A swarm specialist that IS a sequential pipeline
const billing = FlowChart.create()
  .agent('classify', classifyAgent)
  .agent('process', processAgent)
  .build();

const support = Swarm.create({ provider })
  .specialist('billing', 'Handles billing', billing)
  .specialist('technical', 'Handles tech', techAgent)
  .build();
```

## Builder → Runner

Every builder produces a runner via `.build()`:

```typescript
const agent = Agent.create({ provider })
  .system('You are helpful.')
  .tool(searchTool)
  .recorder(obs)        // attach recorders before build
  .build();             // → AgentRunner

const result = await agent.run('Hello');
result.content;         // LLM response
```

Runners expose: `run()`, `getSnapshot()`, `getNarrative()`, `getNarrativeEntries()`, `getSpec()`.

## Internally

Each concept builds a footprintjs flowchart with known stages (Seed → SystemPrompt → Messages → Tools → CallLLM → ParseResponse → RouteResponse → ExecuteTools/Finalize). The runner wraps a `FlowChartExecutor`. All data collection happens during the single DFS traversal — see `recorders/README.md`.
