# Security — Tool Gating & Provider Resilience

Production agent systems face two problems that infrastructure alone can't solve:

1. **Tool visibility** — The LLM sees every tool description. If a user shouldn't access a tool, the LLM shouldn't know it exists. API gateways block requests, but the LLM still reasons about tools it can see. That wastes tokens, causes hallucinated tool calls, and leaks capability information.

2. **Provider availability** — A single LLM provider goes down and your agent is down. Traditional load balancers can't switch between model families (Claude → GPT → local). And when fallback happens, the narrative should reflect which model actually answered.

agentfootprint solves both at the agent level — where the LLM decision happens, not at the infrastructure level where it's too late.

> **Background on tool visibility as an attack surface:** Greshake et al. 2023 ("Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection") showed that any tool description an LLM can read becomes part of its attack surface — a malicious tool description can hijack the agent. Filtering tools at *resolve* time (not just at *execute* time) is a defense, not just a UX nicety.

Here's how each problem is solved in the library.

---

## Tool Gating — `gatedTools`

Wraps any `ToolProvider` with two layers of permission enforcement:

```typescript
import { Agent, mock, defineTool, gatedTools, staticTools } from 'agentfootprint';

const tools = staticTools([searchTool, adminTool, codeTool]);

// Only allow search and code — admin is hidden from LLM
const gated = gatedTools(tools, (toolId) => userPermissions.has(toolId));

const agent = Agent.create({ provider })
  .system('You are helpful.')
  .toolProvider(gated)
  .build();
```

### How It Works

**Layer 1 — resolve():** The LLM never sees blocked tools. They're filtered before tool descriptions are sent to the API. The LLM can't hallucinate a tool it doesn't know exists.

**Layer 2 — execute():** If the LLM somehow calls a blocked tool (prompt injection, hallucination), the call returns `{ error: true, content: "Permission denied" }`. This error flows into the conversation history — the LLM reads it and stops trying.

Both layers run every loop iteration. Permissions can change mid-conversation (e.g., after the user authenticates).

**What's novel here:** MCP allow-lists and OpenAI's tool filtering exist; they operate at a single layer (typically execute-time). `gatedTools` enforces at **both** layers (resolve **and** execute), wires permission events into the recorder system for an audit trail, and recomputes per loop iteration so policies that depend on conversation state work without restarting the agent. The two-layer + audit-trail combination is what's specific to agentfootprint.

### Context-Aware Permissions

The permission checker receives the full `ToolContext` — message, turn number, conversation history:

```typescript
const gated = gatedTools(tools, (toolId, ctx) => {
  // Rate limit: no tools after 5 turns
  if (ctx.turnNumber > 5) return false;
  // Only allow submit tool after research is done
  if (toolId === 'submit' && ctx.loopIteration < 2) return false;
  return allowedTools.has(toolId);
});
```

> **Checker exception behavior:** if your checker throws, the tool is treated as **denied** (fail-closed) and an `onBlocked(toolId, 'error')` event fires. Make sure your checker is total — exceptions don't fall through to "allow."

### Observability — `onBlocked`

The optional `onBlocked` callback fires during traversal (not post-processing):

```typescript
const gated = gatedTools(tools, checker, {
  onBlocked: (toolId, phase) => {
    console.log(`Blocked ${toolId} at ${phase} phase`);
    metrics.increment('tool.permission.blocked', { tool: toolId });
  },
});
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `onBlocked` | `(toolId, phase, ctx?) => void` | Called when a tool is blocked at resolve or execute |

---

## Centralized Permissions — `PermissionPolicy`

When multiple agents share the same permission rules, create one `PermissionPolicy` and pass it to each:

```typescript
import { PermissionPolicy, gatedTools, staticTools } from 'agentfootprint';

// One policy, shared across agents
const policy = new PermissionPolicy(['search', 'calc']);

const agent1 = Agent.create({ provider })
  .toolProvider(gatedTools(tools1, policy.checker()))
  .build();

const agent2 = Agent.create({ provider })
  .toolProvider(gatedTools(tools2, policy.checker()))
  .build();

// Runtime changes — both agents see it immediately
policy.grant('admin-tool');   // now both agents can use admin-tool
policy.revoke('search');       // now neither can
```

### Role-Based Access

```typescript
const policy = PermissionPolicy.fromRoles({
  user: ['search', 'calc'],
  admin: ['search', 'calc', 'delete-user', 'run-code'],
  readonly: ['search'],
}, 'user');

// Upgrade mid-conversation
policy.setRole('admin');  // admin tools now available on next LLM turn
```

### Audit Trail — `onChange`

```typescript
const policy = new PermissionPolicy(['search'], {
  onChange: (event) => {
    // event: { type: 'grant'|'revoke'|'role-change', toolId?, role?, allowed: string[] }
    auditLog.write(event);
  },
});
```

### API

| Method | Description |
|--------|-------------|
| `grant(toolId)` | Add tool access |
| `revoke(toolId)` | Remove tool access |
| `isAllowed(toolId)` | Check if tool is permitted |
| `getAllowed()` | List all permitted tool IDs |
| `setRole(role)` | Switch role (fromRoles only) |
| `getRole()` | Current role name |
| `checker()` | Returns `PermissionChecker` for `gatedTools()` |

---

## Permission Audit — `PermissionRecorder`

An `AgentRecorder` that captures every permission decision for audit:

```typescript
import { PermissionRecorder, gatedTools, staticTools } from 'agentfootprint';

const permRecorder = new PermissionRecorder();

const gated = gatedTools(tools, checker, {
  onBlocked: permRecorder.onBlocked,  // wire the bridge
});

const agent = Agent.create({ provider })
  .toolProvider(gated)
  .recorder(permRecorder)   // also captures successful tool calls
  .build();

await agent.run('Do something');

// Full audit
console.log(permRecorder.getSummary());
// { allowed: ['search'], blocked: ['admin', 'code'], denied: [] }

// Individual queries
permRecorder.getBlocked();   // tools hidden from LLM
permRecorder.getDenied();    // hallucinated calls rejected at execute
permRecorder.getAllowed();   // tools that executed successfully
permRecorder.getEvents();   // full event timeline
```

Events are captured during traversal — `onBlocked` fires during `resolve()` and `execute()`, `onToolCall` fires after tool execution.

---

## Provider Fallback — `fallbackProvider`

Wraps multiple `LLMProvider` instances into one. Tries providers in order. On failure, falls through to the next.

```typescript
import { fallbackProvider, AnthropicAdapter, OpenAIAdapter } from 'agentfootprint';

const provider = fallbackProvider([
  new AnthropicAdapter({ model: 'claude-sonnet-4-20250514' }),
  new OpenAIAdapter({ model: 'gpt-4o' }),
  new OpenAIAdapter({ model: 'llama3', baseURL: 'http://localhost:11434/v1' }),
]);

const agent = Agent.create({ provider }).system('You are helpful.').build();
// Tries Claude → GPT-4o → local Ollama
```

### Why at the Provider Level

Infrastructure-level load balancers can't switch between model families. A load balancer for Anthropic's API can fail over to another Anthropic region — but it can't fail over to OpenAI. `fallbackProvider` operates at the `LLMProvider` interface, so it can switch between any provider that implements `chat()`.

The response includes `model` from whichever provider succeeded. Recorders capture this via `onLLMCall.model` — so the narrative reflects which model actually answered.

### Selective Fallback

Only fall back on specific errors — let auth errors propagate:

```typescript
import { fallbackProvider, LLMError } from 'agentfootprint';

const provider = fallbackProvider([primary, backup], {
  shouldFallback: (err) => {
    if (err instanceof LLMError) {
      return err.code === 'rate_limit' || err.code === 'server' || err.code === 'timeout';
    }
    return false; // don't fall back on auth errors
  },
  onFallback: (fromIdx, toIdx, error) => {
    console.warn(`Provider ${fromIdx} failed, trying ${toIdx}:`, error.message);
  },
});
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `shouldFallback` | `(error) => boolean` | Only fall back if this returns true. Default: always |
| `onFallback` | `(from, to, error) => void` | Called during traversal when switching providers |

---

## Resilient Provider — `resilientProvider`

Combines `fallbackProvider` + per-provider circuit breakers. When a provider is known to be down (breaker tripped), it's skipped instantly — no wasted latency waiting for timeouts.

```typescript
import { resilientProvider, AnthropicAdapter, OpenAIAdapter } from 'agentfootprint';

const provider = resilientProvider([
  new AnthropicAdapter({ model: 'claude-sonnet-4-20250514' }),
  new OpenAIAdapter({ model: 'gpt-4o' }),
  new OpenAIAdapter({ model: 'llama3', baseURL: 'http://localhost:11434/v1' }),
], {
  circuitBreaker: { threshold: 3, resetAfterMs: 30_000 },
  onFallback: (from, to, err) => console.warn(`Switching ${from} → ${to}`),
});

const agent = Agent.create({ provider }).system('You are helpful.').build();

// After 3 consecutive Claude failures, the breaker trips.
// Subsequent calls skip Claude entirely → go straight to GPT-4o.
// After 30s, one probe call tests if Claude is back.
```

### Inspecting Breaker State

```typescript
const p = resilientProvider([claude, gpt, ollama]);

p.breakers[0].getState(); // 'closed' | 'open' | 'half_open'
p.breakers[1].getState();
p.breakers[2].getState();
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `circuitBreaker` | `{ threshold?, resetAfterMs? }` | Per-provider breaker config. Default: 3 failures, 30s reset |
| `shouldFallback` | `(error) => boolean` | Only fall back if true |
| `onFallback` | `(from, to, error) => void` | Called on each transition |

---

## Full Production Stack

These compose into a layered security + resilience strategy:

```typescript
import {
  Agent, PermissionPolicy, PermissionRecorder, gatedTools,
  staticTools, resilientProvider, AnthropicAdapter, OpenAIAdapter,
  CompositeRecorder, TokenRecorder,
} from 'agentfootprint';

// 1. Permission policy (centralized, shared)
const policy = PermissionPolicy.fromRoles({
  user: ['search', 'calc'],
  admin: ['search', 'calc', 'delete-user', 'run-code'],
}, 'user');

// 2. Resilient provider (fallback + circuit breaker)
const provider = resilientProvider([
  new AnthropicAdapter({ model: 'claude-sonnet-4-20250514' }),
  new OpenAIAdapter({ model: 'gpt-4o' }),
], {
  circuitBreaker: { threshold: 3, resetAfterMs: 30_000 },
});

// 3. Recorders (audit + metrics)
const permRecorder = new PermissionRecorder();
const tokens = new TokenRecorder();

// 4. Gated tools (permission enforcement)
const tools = gatedTools(
  staticTools([searchTool, calcTool, adminTool, codeTool]),
  policy.checker(),
  { onBlocked: permRecorder.onBlocked },
);

// 5. Agent
const agent = Agent.create({ provider })
  .system('You are helpful.')
  .toolProvider(tools)
  .recorder(new CompositeRecorder([permRecorder, tokens]))
  .build();

await agent.run('Help me with something');

// Audit
console.log(permRecorder.getSummary());
// { allowed: ['search'], blocked: ['delete-user', 'run-code'], denied: [] }

// Upgrade permissions mid-conversation
policy.setRole('admin');
// Next turn: LLM sees all tools
```
