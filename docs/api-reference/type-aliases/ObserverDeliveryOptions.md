[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ObserverDeliveryOptions

# Type Alias: ObserverDeliveryOptions

> **ObserverDeliveryOptions** = `Omit`\<`AttachRecorderOptions`, `"delivery"`\>

Defined in: [src/core/agent/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/agent/types.ts#L51)

Dials for the deferred observer queue (RFC-001) — only meaningful with
`observerDelivery: 'deferred'` (passing them without it throws at
construction). Same vocabulary as footprintjs's `AttachRecorderOptions`
minus `delivery` (the Agent option IS the delivery switch):
`capture` (default `'clone'` — hooks receive the same event shape as
inline), `maxQueue` (default 10 000), `overflow` (default
`'drop-oldest'`), `sampleEvery`, `flushBudgetMs` (default 2).
