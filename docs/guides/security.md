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
import { Agent, gatedTools, staticTools } from 'agentfootprint';

const tools = staticTools([searchTool, adminTool, codeTool]);

// Only allow search and code — admin is hidden from LLM
const gated = gatedTools(tools, (toolName) => userPermissions.has(toolName));

const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929' })
  .system('You are helpful.')
  .toolProvider(gated)
  .build();
```

`gatedTools(inner, predicate)` takes exactly two arguments: the inner `ToolProvider` to wrap, and a `ToolGatePredicate` — `(toolName: string, ctx: ToolDispatchContext) => boolean`. The predicate runs once per tool, per ReAct iteration; return `true` to keep the tool visible, `false` to hide it. The tool name comes from `tool.schema.name`.

### The Two Layers of Enforcement

**Layer 1 — visibility (`gatedTools`):** The LLM never sees blocked tools. The agent calls `provider.list(ctx)` each iteration, and `gatedTools` filters the result before tool descriptions are sent to the model. The LLM can't hallucinate a tool it doesn't know exists. Because the list is recomputed every iteration, policies that depend on conversation state work without restarting the agent.

**Layer 2 — execution (`permissionChecker`):** If a tool *is* visible but you still want a runtime guard before it runs, pass a `PermissionChecker` to `Agent.create({ permissionChecker })`. Before every `tool.execute()`, the agent calls `permissionChecker.check({ capability: 'tool_call', target: toolName, ... })`, emits `agentfootprint.permission.check` with the decision, and on `deny` skips the tool and feeds a synthetic denial string back into the conversation. `PermissionPolicy` (below) implements `PermissionChecker`, so the same policy can drive both layers.

```typescript
const policy = PermissionPolicy.fromRoles({ user: ['search', 'code'] }, 'user');

const agent = Agent.create({
  provider,
  model: 'claude-sonnet-4-5-20250929',
  permissionChecker: policy, // execute-time guard
})
  .system('You are helpful.')
  .toolProvider(gatedTools(tools, (name) => policy.isAllowed(name))) // visibility
  .build();
```

> **Predicate exception behavior:** the `gatedTools` predicate is expected to be total. If it throws, the error escapes — a buggy predicate crashes loudly rather than silently allowing tools through. Keep the predicate pure and exception-free; do role/identity lookups before building it.

> **Background on tool visibility as an attack surface:** MCP allow-lists and OpenAI's tool filtering operate at a single layer (typically execute-time). The combination here — visibility filtering at list-time *plus* an optional execute-time `permissionChecker`, both recomputed per iteration — is what closes the gap that single-layer gates leave open.

### Context-Aware Permissions

The predicate receives the read-only `ToolDispatchContext` — the current iteration, the active skill id, and the caller identity:

```typescript
const gated = gatedTools(tools, (toolName, ctx) => {
  // Rate limit: no tools after iteration 5
  if (ctx.iteration > 5) return false;
  // Only show the active skill's tools
  if (ctx.activeSkillId) return skillToolMap[ctx.activeSkillId]?.includes(toolName) ?? false;
  // Tenant-scoped allowlist
  return allowedTools.has(toolName);
});
```

`ToolDispatchContext` fields: `iteration` (1-based ReAct iteration), `activeSkillId?` (set by `read_skill` activation, cleared between turns), `identity?` (`{ tenant?, principal?, conversationId }` from `agent.run({ identity })`), and `signal?` (abort signal for async providers).

---

## Centralized Permissions — `PermissionPolicy`

When multiple agents share the same permission rules, build one `PermissionPolicy` and pass its `isAllowed` predicate to each. The policy is **immutable** — you construct it with `PermissionPolicy.fromRoles(roles, activeRole)` (the constructor is private), and you derive role changes by creating a sibling policy with `withActiveRole(...)`.

```typescript
import { PermissionPolicy, gatedTools, staticTools } from 'agentfootprint';

// One policy, shared across agents
const policy = PermissionPolicy.fromRoles(
  {
    user: ['search', 'calc'],
    admin: ['search', 'calc', 'admin-tool'],
  },
  'user',
);

const agent1 = Agent.create({ provider, model })
  .toolProvider(gatedTools(tools1, (name) => policy.isAllowed(name)))
  .build();

const agent2 = Agent.create({ provider, model })
  .toolProvider(gatedTools(tools2, (name) => policy.isAllowed(name)))
  .build();
```

### Role-Based Access

```typescript
const policy = PermissionPolicy.fromRoles({
  user: ['search', 'calc'],
  admin: ['search', 'calc', 'delete-user', 'run-code'],
  readonly: ['search'],
}, 'user');

policy.isAllowed('search');        // → true
policy.isAllowed('delete-user');   // → false (not in 'user' role)

// Derive an admin policy — original is unchanged (immutable)
const adminPolicy = policy.withActiveRole('admin');
adminPolicy.isAllowed('delete-user'); // → true
```

To upgrade permissions mid-conversation, swap the predicate's closed-over policy (e.g. via a small holder) or rebuild the agent's `toolProvider` with `adminPolicy.isAllowed`. The policy itself never mutates, which keeps it safe to share across concurrent runs.

### Execute-Time Use — `PermissionChecker`

`PermissionPolicy` also satisfies the `PermissionChecker` interface (it implements an async `check(request)` returning `{ result: 'allow' | 'deny', policyRuleId, rationale? }`). Pass the policy directly to the agent for execute-time enforcement:

```typescript
const agent = Agent.create({ provider, model, permissionChecker: policy }).build();
```

### API

| Member | Description |
|--------|-------------|
| `PermissionPolicy.fromRoles(roles, activeRole)` | Static factory — the only constructor. Throws if `activeRole` isn't a defined role |
| `isAllowed(toolId)` | Sync check against the active role's allowlist (use as the `gatedTools` predicate) |
| `check(request)` | Async `PermissionChecker` method — returns a structured `PermissionDecision` |
| `withActiveRole(role)` | Derive a NEW policy with a different active role (original unchanged) |
| `allowedToolIds()` | List all tool ids permitted under the active role |
| `activeRole` (getter) | The currently active role name |
| `roles` (getter) | All defined role names |

---

## Permission Audit — `agentfootprint.permission.check`

Every execute-time decision made by a `permissionChecker` is emitted as an `agentfootprint.permission.check` event. Subscribe to it directly on the agent — `Agent` exposes the typed `.on(type, listener)` dispatcher:

```typescript
const policy = PermissionPolicy.fromRoles(
  { user: ['search'], admin: ['search', 'admin', 'code'] },
  'user',
);

const agent = Agent.create({ provider, model, permissionChecker: policy })
  .system('You are helpful.')
  .toolProvider(gatedTools(tools, (name) => policy.isAllowed(name)))
  .build();

const audit: Array<{ tool?: string; result: string }> = [];
agent.on('agentfootprint.permission.check', (event) => {
  // event.payload: { capability, actor, target?, result, policyRuleId?, rationale?, ... }
  audit.push({ tool: event.payload.target, result: event.payload.result });
});

await agent.run({ message: 'Do something' });

console.log(audit);
// e.g. [ { tool: 'search', result: 'allow' }, { tool: 'admin', result: 'deny' } ]
```

`PermissionCheckPayload.result` is one of `'allow' | 'deny' | 'halt' | 'gate_open'`. The event also carries `capability` (`'tool_call'` for tool gating), `actor`, `policyRuleId` (e.g. `'user.allowlist.miss'`), and `rationale`. The listener fires during traversal — `.on(...)` returns an `Unsubscribe` function you can call to detach.

> Tools hidden at *list-time* by `gatedTools` never reach the checker, so they produce no `permission.check` event. To audit visibility decisions too, log them in your `gatedTools` predicate.

---

## Provider Fallback — `fallbackProvider`

Wraps multiple `LLMProvider` instances into one. Tries providers in order. On failure, falls through to the next. It lives on the `agentfootprint/resilience` subpath, and the vendor providers come from `agentfootprint/llm-providers`.

```typescript
import { fallbackProvider } from 'agentfootprint/resilience';
import { anthropic, openai } from 'agentfootprint/llm-providers';

// Providers are passed as varargs (not an array)
const provider = fallbackProvider(
  anthropic(),                                              // ANTHROPIC_API_KEY
  openai(),                                                 // OPENAI_API_KEY
  openai({ baseURL: 'http://localhost:11434/v1' }),         // local Ollama
);

const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929' })
  .system('You are helpful.')
  .build();
// Tries Claude → GPT-4o → local Ollama
```

### Why at the Provider Level

Infrastructure-level load balancers can't switch between model families. A load balancer for Anthropic's API can fail over to another Anthropic region — but it can't fail over to OpenAI. `fallbackProvider` operates at the `LLMProvider` interface, so it can switch between any provider that implements `complete()`.

The response carries the `model` from whichever provider succeeded, so recorders and the narrative reflect which model actually answered.

### Selective Fallback

Only fall back on specific errors — let auth errors propagate. When you need options, they go FIRST, followed by the providers as varargs:

```typescript
import { fallbackProvider } from 'agentfootprint/resilience';

const provider = fallbackProvider(
  {
    shouldFallback: (err) => {
      // Inspect your provider's error shape; e.g. HTTP status from the SDK error.
      const status = (err as { status?: number })?.status;
      return status === 429 || status === 500 || status === 503;
      // returning false here keeps auth/4xx errors propagating
    },
    onFallback: (error) => {
      console.warn('Primary failed, falling back:', (error as Error)?.message);
    },
  },
  primary,
  backup,
);
```

### Options (`FallbackProviderOptions`)

| Option | Type | Description |
|--------|------|-------------|
| `shouldFallback` | `(error) => boolean` | Only fall back if this returns true. Default: every error except `AbortError` |
| `onFallback` | `(error) => void` | Called when the primary fails and the fallback is about to run |
| `name` | `string` | Optional explicit name for the chained provider |

---

## Circuit Breakers — `withCircuitBreaker` + `withFallback`

For full production resilience, wrap each provider in `withCircuitBreaker` and chain them with `withFallback` (or `fallbackProvider`). When a provider is known to be down (its breaker is OPEN), the call fails fast in `<1ms` — no wasted latency waiting for timeouts — and the fallback routes around it. There is no single `resilientProvider` factory; you compose these two decorators, which is what gives you per-provider breaker state.

```typescript
import { withCircuitBreaker, withFallback } from 'agentfootprint/resilience';
import { anthropic, openai } from 'agentfootprint/llm-providers';

const provider = withFallback(
  withCircuitBreaker(anthropic(), { failureThreshold: 3, cooldownMs: 30_000 }),
  withCircuitBreaker(openai()),
);

const agent = Agent.create({ provider, model: 'claude-sonnet-4-5-20250929' })
  .system('You are helpful.')
  .build();

// After 3 consecutive Claude failures, the breaker OPENS.
// Subsequent calls throw CircuitOpenError immediately → withFallback routes to GPT-4o.
// After 30s, one probe call tests if Claude is back.
```

`fallbackProvider` chains more than two: `fallbackProvider(withCircuitBreaker(a), withCircuitBreaker(b), withCircuitBreaker(c))`.

### Inspecting Breaker State

Each breaker holds its own state in process memory. Observe transitions through the `onStateChange` hook (there is no array of breakers to poll):

```typescript
import { withCircuitBreaker, type CircuitState } from 'agentfootprint/resilience';

let claudeState: CircuitState = 'closed'; // 'closed' | 'open' | 'half-open'

const claude = withCircuitBreaker(anthropic(), {
  failureThreshold: 3,
  cooldownMs: 30_000,
  onStateChange: (state, reason) => {
    claudeState = state;
    console.log(`Claude breaker → ${state} (${reason})`);
  },
});
```

When the breaker is OPEN, `complete()` throws `CircuitOpenError` (also exported from `agentfootprint/resilience`); `withFallback` catches it and routes to the next provider.

### Options (`WithCircuitBreakerOptions`)

| Option | Type | Description |
|--------|------|-------------|
| `failureThreshold` | `number` | Consecutive failures before the breaker OPENS. Default 5 |
| `cooldownMs` | `number` | How long the breaker stays OPEN before probing. Default 30000 |
| `halfOpenSuccessThreshold` | `number` | Probe successes needed to fully CLOSE. Default 2 |
| `shouldCount` | `(error) => boolean` | Does this error count toward the threshold? Default: all except `AbortError` |
| `onStateChange` | `(state, reason) => void` | Called on every state transition |

---

## Full Production Stack

These compose into a layered security + resilience strategy:

```typescript
import { Agent, PermissionPolicy, gatedTools, staticTools } from 'agentfootprint';
import { withCircuitBreaker, withFallback } from 'agentfootprint/resilience';
import { anthropic, openai } from 'agentfootprint/llm-providers';

// 1. Permission policy (centralized, shared) — immutable
const policy = PermissionPolicy.fromRoles({
  user: ['search', 'calc'],
  admin: ['search', 'calc', 'delete-user', 'run-code'],
}, 'user');

// 2. Resilient provider (fallback + per-provider circuit breakers)
const provider = withFallback(
  withCircuitBreaker(anthropic(), { failureThreshold: 3, cooldownMs: 30_000 }),
  withCircuitBreaker(openai()),
);

// 3. Gated tools (visibility filtering at list-time)
const tools = gatedTools(
  staticTools([searchTool, calcTool, adminTool, codeTool]),
  (name) => policy.isAllowed(name),
);

// 4. Agent — policy also drives execute-time enforcement via permissionChecker
const agent = Agent.create({
  provider,
  model: 'claude-sonnet-4-5-20250929',
  permissionChecker: policy,
})
  .system('You are helpful.')
  .toolProvider(tools)
  .build();

// 5. Audit every execute-time decision
const denied: string[] = [];
agent.on('agentfootprint.permission.check', (event) => {
  if (event.payload.result === 'deny') denied.push(event.payload.target ?? '');
});

await agent.run({ message: 'Help me with something' });

console.log(denied); // e.g. ['delete-user']

// Upgrade permissions mid-conversation by deriving an admin policy and
// rebuilding the agent (the policy itself is immutable):
const adminPolicy = policy.withActiveRole('admin');
```
