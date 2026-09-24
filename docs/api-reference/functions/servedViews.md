[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / servedViews

# Function: servedViews()

> **servedViews**(`source`): [`ServedView`](/agentfootprint/api/generated/interfaces/ServedView.md)[]

Defined in: [src/lib/time-travel/servedView.ts:1298](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L1298)

Every epoch's served view, in run order — `servedAt` for a whole run, with
one pass over the recording instead of one per epoch.

## Parameters

### source

`unknown`

## Returns

[`ServedView`](/agentfootprint/api/generated/interfaces/ServedView.md)[]

## Example

```ts
servedViews(agent.getSnapshot()!).map((v) => v.tools.names.length); // [3, 3, 0]
```
