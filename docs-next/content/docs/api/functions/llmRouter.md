---
title: llmRouter
---

# Function: llmRouter()

> **llmRouter**(`opts`): [`LlmRouter`](/docs/api/interfaces/LlmRouter)

Defined in: [src/patterns/LlmRouter.ts:515](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmRouter.ts#L515)

Build an LLM-driven router for a fixed agent roster.

The roster compiles into the router's system prompt from each agent's
own `description`, so prompt and roster cannot drift. The decision is
parsed and validated; `reason` stays in the trace.

## Parameters

### opts

[`LlmRouterOptions`](/docs/api/interfaces/LlmRouterOptions)

## Returns

[`LlmRouter`](/docs/api/interfaces/LlmRouter)

## Example

```ts
const router = llmRouter({
  provider,
  model: 'claude-sonnet-4-5',
  agents: [
    { id: 'billing', description: 'Invoices, refunds, payment methods.' },
    { id: 'tech', description: 'Login problems, errors, outages.' },
  ],
  instruction: 'Anything money-shaped goes to billing.',
});

await router.step.run({ message: 'my invoice is wrong' });
router.route({ message: 'my invoice is wrong' }); // → 'billing'
router.decisions().at(-1)?.reason;                // → why, for the trace
```
