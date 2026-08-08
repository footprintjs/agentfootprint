[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / llmRouter

# Function: llmRouter()

> **llmRouter**(`opts`): [`LlmRouter`](/agentfootprint/api/generated/interfaces/LlmRouter.md)

Defined in: [src/patterns/LlmRouter.ts:515](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/patterns/LlmRouter.ts#L515)

Build an LLM-driven router for a fixed agent roster.

The roster compiles into the router's system prompt from each agent's
own `description`, so prompt and roster cannot drift. The decision is
parsed and validated; `reason` stays in the trace.

## Parameters

### opts

[`LlmRouterOptions`](/agentfootprint/api/generated/interfaces/LlmRouterOptions.md)

## Returns

[`LlmRouter`](/agentfootprint/api/generated/interfaces/LlmRouter.md)

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
