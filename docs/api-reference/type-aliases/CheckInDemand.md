[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInDemand

# Type Alias: CheckInDemand\<TArgs\>

> **CheckInDemand**\<`TArgs`\> = `"always"` \| ((`args`, `ctx`) => `boolean`)

Defined in: [src/core/checkin.ts:175](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/checkin.ts#L175)

What a tool declares to demand a check-in. `'always'` trips on every call;
a predicate trips selectively (e.g. only high-value refunds). A predicate
that throws trips (fail toward asking the human — consequential actions
should not silently proceed on a buggy predicate).

## Type Parameters

### TArgs

`TArgs` = `Readonly`\<`Record`\<`string`, `unknown`\>\>
