---
name: Full integration — RAG + Agent + tools
group: integrations
guide: ../../docs/guides/concepts.md
defaultInput: Where is my order ORD-123?
---

# Full integration — RAG + Agent + tools

End-to-end recipe combining the seven concepts in a realistic flow. RAG sets up document lookup; an Agent with tools handles the operational query. Demonstrates how the concepts compose into a real customer-support shape.

## When to use

- As a starting template for production systems.
- To see what a multi-concept agent looks like end-to-end.
- For onboarding — once a developer has read the individual `concepts/*` examples, this shows them composed.

## What you'll see

The agent calls `lookup_order(ORD-123)`, reads the result, responds:

```
{ content: 'Your order ORD-123 has been shipped. Total was $49.99.' }
```

## Key API

This example uses `Agent.create(...)` + `defineTool(...)` + `RAG.create(...)` together. See the individual concept examples for each piece.

## In production

Swap each `mock(...)` for a real provider:

```typescript
import { createProvider, anthropic } from 'agentfootprint/providers';
const provider = createProvider(anthropic('claude-sonnet-4-20250514'));
```

Add observability, retry, and gating per the `observability/`, `resilience/`, and `security/` example folders.

## Related

- [concepts/02-agent](../concepts/02-agent.md), [concepts/03-rag](../concepts/03-rag.md) — the building blocks.
- [observability/01-recorders](../observability/01-recorders.md) — wire one recorder for tokens + tools + cost + grounding.
