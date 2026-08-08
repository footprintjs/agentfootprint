[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OutputSchemaStrategy

# Type Alias: OutputSchemaStrategy

> **OutputSchemaStrategy** = `"instruct"` \| `"tool-forced"`

Defined in: [src/core/outputSchema.ts:88](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/outputSchema.ts#L88)

How the schema reaches the model.

  • `'instruct'` (default) — the shape is described in the system prompt
    and the model is asked for JSON. Works on every provider, because it
    is only words.
  • `'tool-forced'` — the shape is presented as a synthetic tool and the
    provider's tool choice is FORCED to it, so generation is constrained
    at the source instead of requested in prose. Requires a provider that
    declares `carriesForcedToolChoice`; a provider that does not is
    refused BY NAME at run start rather than quietly downgraded, because
    a strategy that silently falls back to the other one is config that
    lies.
