[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / PermissionHaltPayload

# Interface: PermissionHaltPayload

Defined in: [src/events/payloads.ts:441](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L441)

Emitted (v2.12) when a `PermissionChecker.check()` returns
`{ result: 'halt', ... }`. Pairs with the typed `PolicyHaltError`
thrown by `Agent.run()` — the event is the OBSERVABILITY signal,
the error is the RUNTIME signal. Both carry the same `reason` for
routing (e.g. `'security:exfiltration'` → PagerDuty).

Fires AFTER the synthetic tool_result has been written to scope.history
but BEFORE the run terminates, so observability adapters see the
halt while the conversation history is consistent for downstream
audit/replay.

## Properties

### checkerId?

> `readonly` `optional` **checkerId?**: `string`

Defined in: [src/events/payloads.ts:442](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L442)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:446](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L446)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/events/payloads.ts:444](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L444)

***

### sequenceLength

> `readonly` **sequenceLength**: `number`

Defined in: [src/events/payloads.ts:447](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L447)

***

### target

> `readonly` **target**: `string`

Defined in: [src/events/payloads.ts:443](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L443)

***

### tellLLM?

> `readonly` `optional` **tellLLM?**: `string`

Defined in: [src/events/payloads.ts:445](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L445)
