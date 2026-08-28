---
title: AgentRecordingsOptions
---

# Interface: AgentRecordingsOptions

Defined in: [src/core/agent/types.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L135)

The object form of [AgentArtifactsOptions.recordings](/docs/api/interfaces/AgentArtifactsOptions#recordings).

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/core/agent/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L144)

The label every minted recording carries, verbatim.

Absent, each is labelled `run <runId>`. A static label repeats across runs
on purpose — what distinguishes two recordings is the ref and
`origin.runId`, and a library that decorated your label to make it unique
would be overruling the name you chose.
