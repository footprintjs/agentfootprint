---
name: Tool-level instructions (LLM guidance + follow-ups)
group: runtime-features
guide: ../../../docs/guides/instructions.md
defaultInput: Evaluate a loan for Jane Doe, credit score 580, $25,000
---

# Tool-level instructions (LLM guidance + follow-ups)

Co-locate LLM guidance with the tool that produces the result. When the loan-evaluation tool returns `denied`, the agent automatically sees "be empathetic; don't promise reversal" injected into the recency window — right next to the tool result, where the model pays the most attention.

## Three tiers

| Tier | Triggered when | Effect |
|---|---|---|
| `inject` | Predicate matches the tool result | Adds guidance text |
| `followUp` | Same | Suggests a next-call tool the LLM can use |
| `safety: true` | Always (fail-closed if predicate throws) | Inserted LAST in the output (highest attention) |

## When to use

- Tools whose results need different framing depending on outcome (denial vs approval).
- Compliance — "if PII is in the result, don't echo it" as a `safety` instruction.
- Workflow continuation — "here's a follow-up tool you can call to get more detail."

## What you'll see

```
{
  agentResponse: "I'm sorry, the loan was denied due to credit score...",
  instructionsInjected: true,
  followUpInjected: true,
  messageCount: <n>,
}
```

The tool-result message contains `[INSTRUCTION] ...` and `[AVAILABLE ACTION] get_denial_trace(traceId=...)` markers, visible to the LLM.

## Key API

- `defineTool({ ..., instructions: [{ id, when, inject, followUp?, priority?, safety? }] })`.
- `quickBind('tool_id', 'paramName', { description, condition })` — declarative follow-up binding.

## Related

- [instructions guide](../../../docs/guides/instructions.md) — full architecture, fail-closed safety semantics, `InstructionRecorder`.
- [01-basic](./01-basic.md) — agent-level instructions via `.instruction()`.
