# Providers

> **Like:** swapping ingredients in a recipe without rewriting the recipe. Same agent, different prompt / context / tool source.

`.system("...")`, `.tool(t)`, and the default conversation history are shortcuts. **Providers** are the strategy pattern underneath them — swap *how* the system prompt, message/context, and tool list are computed each turn, without rewriting the agent.

The LLM API accepts three inputs (`system`, `messages`, `tools`), so an agent has three places where you can swap the strategy:

| Slot | Controls | Configure with | Maps to LLM API |
|------|----------|----------------|---|
| **System prompt** | What the model is told to do | `.system(...)`, `.instruction(...)`, `.steering(...)` | `system` |
| **Messages / context** | What facts/history reach the model | `.memory(...)`, `.rag(...)`, `.fact(...)` | `messages` |
| **Tools** | Which tools are available | `.tool(...)`, `.tools(...)`, `.toolProvider(...)` | `tools` |

Three slots, because the LLM API has three slots. In a **dynamic ReAct agent** (the default `reactMode`), all three re-evaluate each loop iteration via the Injection Engine — see [Patterns](patterns.md).

All three are swappable. The agent builder uses simple defaults (the `.system(...)` string, full history, static tools from `.tool()`), and for advanced use cases you plug in **injections** (system prompt / context) or a **`ToolProvider`** (tools).

---

## System prompt slot

The simplest control is `.system(...)` — a fixed prompt:

```typescript
import { Agent, mock } from 'agentfootprint';

const agent = Agent.create({ provider: mock(), model: 'mock-model' })
  .system('You are a helpful assistant.')
  .build();
```

`.system(...)` accepts a cache policy as its second argument:

```typescript
Agent.create({ provider: mock(), model: 'mock-model' })
  .system('You are a helpful assistant.', { cache: 'always' })
  .build();
```

### Dynamic system prompt via injections

To shape the system prompt per turn (instead of a fixed string), use the injection
factories from the `agentfootprint/injection-engine` subpath (also re-exported from
the main barrel). A **steering** rule is always-on; an **instruction** activates
conditionally via an `activeWhen` predicate.

```typescript
import { Agent, mock, defineInstruction, defineSteering } from 'agentfootprint';

const agent = Agent.create({ provider: mock(), model: 'mock-model' })
  .system('You are a helpful assistant.')
  // Always-on guidance:
  .steering(defineSteering({
    id: 'tone',
    prompt: 'Always answer concisely.',
  }))
  // Conditional guidance — only when the message looks code-related:
  .instruction(defineInstruction({
    id: 'code-mode',
    activeWhen: (ctx) => /code|program|function/i.test(ctx.userMessage),
    prompt: 'You are a coding expert. Use precise terminology.',
  }))
  .build();
```

Each injection lands in the `system-prompt` slot and is re-evaluated every
iteration (steering is always active; instructions run their `activeWhen`
predicate). See the Injection Engine docs for `defineInstruction` /
`defineSteering` / `defineSkill` and the full trigger vocabulary.

---

## Messages / context slot

Conversation history flows into the `messages` slot automatically. To control
*what additional context* (facts, retrieved documents, summarized memory) reaches
the model, attach **memory**, **RAG**, or **fact** definitions.

```typescript
import { Agent, mock, defineMemory, defineFact, InMemoryStore } from 'agentfootprint';

const agent = Agent.create({ provider: mock(), model: 'mock-model' })
  .system('You are a helpful assistant.')
  // Keep the last N messages:
  .memory(defineMemory({
    id: 'recent',
    type: 'episodic',
    strategy: { kind: 'window', size: 20 },
    store: new InMemoryStore(),
  }))
  // Inject a standing fact:
  .fact(defineFact({ id: 'tz', data: 'The user is in the US Pacific timezone.' }))
  .build();
```

Memory **strategies** are the message-window controls (replacing any notion of a
standalone "message strategy"): `window`, `budget`, `summarize`, `topK`, `extract`,
`decay`, and `hybrid`. See the Memory docs for `defineMemory`, `defineRAG`, and the
full strategy list.

---

## Tools slot — `ToolProvider`

The tools slot has a first-class, chainable strategy abstraction: **`ToolProvider`**.
A `ToolProvider` answers one question per iteration — *"what tools should the LLM see
right now?"* — via `list(ctx)`.

The simplest control is `.tool(...)` / `.tools(...)` for a fixed list:

```typescript
import { Agent, mock } from 'agentfootprint';

const agent = Agent.create({ provider: mock(), model: 'mock-model' })
  .system('You answer questions.')
  .tools([searchTool, calculatorTool])
  .build();
```

For dynamic / gated tool sources, build a `ToolProvider` and wire it with
`.toolProvider(...)`. The provider primitives live in the
`agentfootprint/tool-providers` subpath:

| Provider | Behavior |
|----------|----------|
| `staticTools(tools)` | Always offer the same fixed list |
| `gatedTools(inner, predicate)` | Decorator: filter an inner provider per-tool, per-iteration |
| `skillScopedTools(...)` | Only expose the active skill's tools each turn |

```typescript
import { Agent, mock } from 'agentfootprint';
import { staticTools, gatedTools } from 'agentfootprint/tool-providers';
import { PermissionPolicy } from 'agentfootprint/security';

const policy = PermissionPolicy.fromRoles({
  readonly: ['lookup', 'list_skills', 'read_skill'],
  admin:    ['lookup', 'list_skills', 'read_skill', 'delete'],
}, 'readonly');

// Read-only enforcement: wrap a static list with a role gate.
const provider = gatedTools(
  staticTools([lookupTool, deleteTool]),
  (toolName) => policy.isAllowed(toolName),
);

const agent = Agent.create({ provider: mock(), model: 'mock-model' })
  .system('You answer questions.')
  .toolProvider(provider)
  .build();
```

The agent consults the provider every iteration with
`ctx = { iteration, activeSkillId?, identity?, signal? }`, so gates can react to the
current skill, caller identity, or cancellation. `.toolProvider(...)` may be called
at most once per agent.

### Custom `ToolProvider`

```typescript
import type { ToolProvider, ToolDispatchContext } from 'agentfootprint/tool-providers';

const contextual: ToolProvider = {
  id: 'first-iteration-only',
  list(ctx: ToolDispatchContext) {
    // Only offer the search tool on the first iteration.
    if (ctx.iteration === 1) return [searchTool];
    return [];
  },
};
```

`list()` may return `readonly Tool[]` (the sync fast path) or a
`Promise<readonly Tool[]>` for discovery-style providers (MCP catalog fetch,
registry pull). A throwing/rejecting provider emits
`agentfootprint.tools.discovery_failed` and aborts the iteration unless a
configured `reliability` rule routes the error. Build `Tool` objects with
`defineTool(...)`.

---

## MCP and dynamic tool discovery

To pull tools from an MCP server, fetch the catalog and register it:

```typescript
import { Agent, mock } from 'agentfootprint';
import { mcpClient } from 'agentfootprint/tool-providers';

const client = await mcpClient({ /* transport config */ });
const agent = Agent.create({ provider: mock(), model: 'mock-model' })
  .system('You answer questions.')
  .tools(await client.tools())
  .build();
```

`mockMcpClient(...)` is available for tests.

---

## LLM provider configuration

The fourth "provider" — the `LLMProvider` that actually calls the model — is
covered separately. See the [Adapters Guide](adapters.md) for `mock`, the browser
adapters, `createProvider`, and the vendor-SDK adapters at
`agentfootprint/llm-providers`.

---

## Measuring strategy quality

There is **no built-in evaluator that scores these strategies for you** — each one
is a quality / cost trade-off you have to measure on your own data. The library
gives you the recorders:

- **`costRecorder()`** — measure the cost side of the trade-off (token spend)
- **`evalRecorder()`** — wire an LLM-as-judge to measure the quality side
- **`ContextRecorder`** — see exactly which injections reached each slot per turn
  (so you can audit what a memory `window` strategy dropped)

When picking between full history, `window: { size: 20 }`, and a `summarize`
strategy, run the same task through each with these recorders attached and compare.
Don't pick by intuition. Attach recorders via `.recorder(...)` on the agent builder.
