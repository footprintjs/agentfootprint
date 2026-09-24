[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneStopsStrategy

# Variable: milestoneStopsStrategy

> `const` **milestoneStopsStrategy**: `TimeTravelStrategy`\<[`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md)\>

Defined in: [src/lib/time-travel/milestoneStops.ts:204](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/milestoneStops.ts#L204)

`milestoneStops` as a footprintjs `TimeTravelStrategy` — what you hand
`timeTravel(snapshot, { strategy })`. Typed over [Milestone](/agentfootprint/api/generated/interfaces/Milestone.md), so the
cursor's stops are `Stop<Milestone>` and `cursor.at()?.meta?.kind` is typed;
it is still assignable wherever a bare `TimeTravelStrategy` is expected.
