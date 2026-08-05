[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ObserverDeliveryOptions

# Type Alias: ObserverDeliveryOptions

> **ObserverDeliveryOptions** = `Omit`\<`AttachRecorderOptions`, `"delivery"`\>

Defined in: [src/core/agent/types.ts:50](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/agent/types.ts#L50)

Dials for the deferred observer queue (RFC-001) — only meaningful with
`observerDelivery: 'deferred'` (passing them without it throws at
construction). Same vocabulary as footprintjs's `AttachRecorderOptions`
minus `delivery` (the Agent option IS the delivery switch):
`capture` (default `'clone'` — hooks receive the same event shape as
inline), `maxQueue` (default 10 000), `overflow` (default
`'drop-oldest'`), `sampleEvery`, `flushBudgetMs` (default 2).
