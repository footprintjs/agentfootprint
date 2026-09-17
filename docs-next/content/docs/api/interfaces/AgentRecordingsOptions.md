---
title: AgentRecordingsOptions
---

# Interface: AgentRecordingsOptions

Defined in: [src/core/agent/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L138)

The object form of [AgentArtifactsOptions.recordings](/docs/api/interfaces/AgentArtifactsOptions#recordings).

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/core/agent/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L147)

The label every minted recording carries, verbatim.

Absent, each is labelled `run <runId>`. A static label repeats across runs
on purpose — what distinguishes two recordings is the ref and
`origin.runId`, and a library that decorated your label to make it unique
would be overruling the name you chose.
