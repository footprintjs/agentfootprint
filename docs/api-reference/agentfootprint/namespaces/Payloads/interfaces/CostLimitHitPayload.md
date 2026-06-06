[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / CostLimitHitPayload

# Interface: CostLimitHitPayload

Defined in: [src/events/payloads.ts:484](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L484)

## Properties

### action

> `readonly` **action**: `"warn"` \| `"abort"` \| `"degrade"`

Defined in: [src/events/payloads.ts:488](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L488)

***

### actual

> `readonly` **actual**: `number`

Defined in: [src/events/payloads.ts:487](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L487)

***

### kind

> `readonly` **kind**: `"max_tokens"` \| `"max_cost"` \| `"max_iterations"` \| `"max_wallclock"`

Defined in: [src/events/payloads.ts:485](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L485)

***

### limit

> `readonly` **limit**: `number`

Defined in: [src/events/payloads.ts:486](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L486)
