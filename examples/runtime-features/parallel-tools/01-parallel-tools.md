---
name: Parallel tool execution within a turn
group: runtime-features
guide: ../../../docs/guides/concepts.md#agent
defaultInput: what do we know about customer cust-42?
---

# Parallel tool execution within a turn

When the LLM requests multiple independent tool calls in one iteration, executing them concurrently shaves real wall time. The toggle is one method call: `.parallelTools(true)`.

## The math

Sequential: `getCustomer (80ms) → getOrders (120ms) → getProduct (60ms)  ≈ 260ms`
Parallel: `Promise.all([getCustomer, getOrders, getProduct])             ≈ 120ms`

Result messages are appended in the order the LLM **requested** them — only the wait time changes.

## When to use

- The LLM regularly calls 2+ tools per turn.
- Tools hit independent backends (no shared state, no ordering dependency).
- You're optimizing latency, not just total tokens.

## When NOT to use

- Tools have ordering dependencies ("create order, then add line item using returned id").
- Tools share a rate limit and parallel calls would hit it harder.

## What you'll see

```
{
  content: 'Alice Chen (premium) has 1 recent order for WIDGET-A — 42 in stock.',
  elapsedMs: <~120>,   // not ~260
  tools: { totalCalls: 3, byTool: { ... } },
}
```

## Key API

- `.parallelTools(true)` on the Agent builder.
- Per-turn behavior — only fires when the LLM requests >1 tool in one iteration.

## Failure modes

- One tool throws → that tool's result is `{ error: true, ... }`; siblings still complete. The LLM sees the mix.
- Streaming `onEvent` events for parallel tools **interleave** in real time order — group by `toolCallId` to reconstruct per-tool order. See [streaming guide](../../../docs/guides/streaming.md#parallel-tool-call-ordering).

## Related

- [streaming/01-events](../streaming/01-events.md) — event ordering with parallel tools.
- [concepts/02-agent](../../concepts/02-agent.md) — the loop this modifies.
