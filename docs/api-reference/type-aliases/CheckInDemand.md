[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInDemand

# Type Alias: CheckInDemand\<TArgs\>

> **CheckInDemand**\<`TArgs`\> = `"always"` \| ((`args`, `ctx`) => `boolean`)

Defined in: [src/core/checkin.ts:258](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/checkin.ts#L258)

What a tool declares to demand a check-in. `'always'` trips on every call;
a predicate trips selectively (e.g. only high-value refunds). A predicate
that throws trips (fail toward asking the human — consequential actions
should not silently proceed on a buggy predicate).

## Type Parameters

### TArgs

`TArgs` = `Readonly`\<`Record`\<`string`, `unknown`\>\>
