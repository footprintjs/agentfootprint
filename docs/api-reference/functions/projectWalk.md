[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / projectWalk

# Function: projectWalk()

> **projectWalk**(`entries`, `cap`): [`ProjectedWalk`](/agentfootprint/api/generated/interfaces/ProjectedWalk.md)

Defined in: [src/core/runbook/walk.ts:78](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/walk.ts#L78)

Apply the cap law. Counters are about the WHOLE narrative (`total`), so a
 projected walk cannot read as a short run.

## Parameters

### entries

readonly `NarrativeEntryView`[]

### cap

`number`

## Returns

[`ProjectedWalk`](/agentfootprint/api/generated/interfaces/ProjectedWalk.md)
