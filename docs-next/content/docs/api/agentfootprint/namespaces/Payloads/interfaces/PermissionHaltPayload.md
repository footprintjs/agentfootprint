---
title: PermissionHaltPayload
---

# Interface: PermissionHaltPayload

Defined in: [src/events/payloads.ts:546](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L546)

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

Defined in: [src/events/payloads.ts:547](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L547)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:551](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L551)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/events/payloads.ts:549](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L549)

***

### sequenceLength

> `readonly` **sequenceLength**: `number`

Defined in: [src/events/payloads.ts:552](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L552)

***

### target

> `readonly` **target**: `string`

Defined in: [src/events/payloads.ts:548](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L548)

***

### tellLLM?

> `readonly` `optional` **tellLLM?**: `string`

Defined in: [src/events/payloads.ts:550](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L550)
