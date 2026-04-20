---
name: defineInstruction — conditional context injection
group: runtime-features
guide: ../../../docs/guides/instructions.md
defaultInput: I want a refund for order ORD-42
---

# defineInstruction — conditional context injection

Some rules should only apply *sometimes*. `defineInstruction` lets you say "when X is true, tell the LLM Y, give it tools Z, and add this guidance after the next tool result." A single instruction can inject into all 3 LLM API positions: system prompt, tools list, and tool-result recency window.

## When to use

- Behavior that depends on conversation state ("only after order is verified", "only for EU users").
- Compliance / safety guidance that must fire when conditions are met.
- Co-locating LLM guidance with the tool that triggered it.

## What you'll see

A support agent looks up an order, then incorporates the refund-policy instruction into its response:

```
Entered SeedScope.
Entered InstructionsToLLM.
  → Activated: refund-policy (prompt + onToolResult)
Entered SystemPrompt. → "You are a support agent. Refund policy: items over $200..."
Entered Tools. → [lookup_order]
Iteration 1:
  Entered CallLLM. → tool_use: lookup_order(ORD-42)
  Entered ExecuteTools. → "{status: shipped, amount: 299}"
                          [recency-injected: "Check if amount > $200..."]
Iteration 2:
  Entered CallLLM. → "Order ORD-42 shipped for $299. Refund requires manager approval."
```

## Key API

- `defineInstruction({ id, prompt?, tools?, onToolResult?, activeWhen?, safety? })`.
- `.instruction(refundInstruction)` on the agent builder.
- `onToolResult: [{ when, text }]` — guidance that lands in the recency window after matching tool calls.

## Related

- [instructions guide](../../../docs/guides/instructions.md) — Decision Scope, the 3 naming conventions, safety instructions.
- [02-llm-instructions](./02-llm-instructions.md) — tool-level instructions (co-located with `defineTool`).
