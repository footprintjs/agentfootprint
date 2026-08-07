[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInDemand

# Type Alias: CheckInDemand\<TArgs\>

> **CheckInDemand**\<`TArgs`\> = `"always"` \| ((`args`, `ctx`) => `boolean`)

Defined in: [src/core/checkin.ts:175](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/core/checkin.ts#L175)

What a tool declares to demand a check-in. `'always'` trips on every call;
a predicate trips selectively (e.g. only high-value refunds). A predicate
that throws trips (fail toward asking the human — consequential actions
should not silently proceed on a buggy predicate).

## Type Parameters

### TArgs

`TArgs` = `Readonly`\<`Record`\<`string`, `unknown`\>\>
