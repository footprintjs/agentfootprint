[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CHART\_WALK\_ARTIFACT\_KIND

# Variable: CHART\_WALK\_ARTIFACT\_KIND

> `const` **CHART\_WALK\_ARTIFACT\_KIND**: `"recording/chart-walk"` = `'recording/chart-walk'`

Defined in: [src/artifacts/recordingArtifact.ts:48](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/recordingArtifact.ts#L48)

The consumer vocabulary a chart WALK is stored under (9.76.0) — one row per
execution step of a runbook's inner chart, with the decider evidence
sentences in the `condition` rows. Namespaced by what it IS (`recording/…`,
beside `recording/run`), never by what produced it: a walk is a recording
projection, not a dataset that happens to mention stages.
