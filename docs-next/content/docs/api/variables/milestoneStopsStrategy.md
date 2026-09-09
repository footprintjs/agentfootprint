---
title: milestoneStopsStrategy
---

# Variable: milestoneStopsStrategy

> `const` **milestoneStopsStrategy**: `TimeTravelStrategy`\<[`Milestone`](/docs/api/interfaces/Milestone)\>

Defined in: [src/lib/time-travel/milestoneStops.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/milestoneStops.ts#L180)

`milestoneStops` as a footprintjs `TimeTravelStrategy` — what you hand
`timeTravel(snapshot, { strategy })`. Typed over [Milestone](/docs/api/interfaces/Milestone), so the
cursor's stops are `Stop<Milestone>` and `cursor.at()?.meta?.kind` is typed;
it is still assignable wherever a bare `TimeTravelStrategy` is expected.
