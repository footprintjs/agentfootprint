[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / projectWalk

# Function: projectWalk()

> **projectWalk**(`entries`, `cap`): [`ProjectedWalk`](/agentfootprint/api/generated/interfaces/ProjectedWalk.md)

Defined in: [src/core/runbook/walk.ts:78](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/walk.ts#L78)

Apply the cap law. Counters are about the WHOLE narrative (`total`), so a
 projected walk cannot read as a short run.

## Parameters

### entries

readonly `NarrativeEntryView`[]

### cap

`number`

## Returns

[`ProjectedWalk`](/agentfootprint/api/generated/interfaces/ProjectedWalk.md)
