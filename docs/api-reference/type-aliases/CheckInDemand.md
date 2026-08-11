[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInDemand

# Type Alias: CheckInDemand\<TArgs\>

> **CheckInDemand**\<`TArgs`\> = `"always"` \| ((`args`, `ctx`) => `boolean`)

Defined in: [src/core/checkin.ts:175](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core/checkin.ts#L175)

What a tool declares to demand a check-in. `'always'` trips on every call;
a predicate trips selectively (e.g. only high-value refunds). A predicate
that throws trips (fail toward asking the human — consequential actions
should not silently proceed on a buggy predicate).

## Type Parameters

### TArgs

`TArgs` = `Readonly`\<`Record`\<`string`, `unknown`\>\>
