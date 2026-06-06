[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / ContextEvaluatedPayload

# Interface: ContextEvaluatedPayload

Defined in: [src/events/payloads.ts:252](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L252)

Fired once per iteration by the Injection Engine after it evaluates every
Injection's trigger — BEFORE the Context fork routes the survivors into the
three slots. This is the "what was considered, what won, what was skipped
and why" signal; `context.slot_composed` is its downstream counterpart
("what actually landed in each slot"). Pure observability — no flow stage
reads it.

## Properties

### activeCount

> `readonly` **activeCount**: `number`

Defined in: [src/events/payloads.ts:255](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L255)

Number of injections active this iteration.

***

### activeIds

> `readonly` **activeIds**: readonly `string`[]

Defined in: [src/events/payloads.ts:261](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L261)

Ids of the active injections, in evaluation order.

***

### evaluatedTotal

> `readonly` **evaluatedTotal**: `number`

Defined in: [src/events/payloads.ts:259](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L259)

Total injections evaluated (the full declared list).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:253](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L253)

***

### skippedCount

> `readonly` **skippedCount**: `number`

Defined in: [src/events/payloads.ts:257](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L257)

Number skipped (predicate false counts as neither — only errors/unknown land here).

***

### skippedDetails

> `readonly` **skippedDetails**: readonly `object`[]

Defined in: [src/events/payloads.ts:263](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L263)

Why each skipped injection was skipped (errors / unknown trigger kinds).

***

### triggerKindCounts

> `readonly` **triggerKindCounts**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [src/events/payloads.ts:269](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L269)

Count of active injections by trigger kind (always / rule / on-tool-return / llm-activated).
