[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentRunCheckpoint

# Interface: AgentRunCheckpoint

Defined in: [src/core/runCheckpoint.ts:59](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L59)

JSON-serializable checkpoint of an in-progress agent run. Persist
to ANY durable store (Redis / Postgres / S3 / disk / queue) and
resume hours / days / deploys later via `agent.resumeOnError(...)`.

**Stable shape** — the `version` field guards forward compat. v1
→ v2 transitions will be supported via a migration helper.

## Properties

### checkpointedAt

> `readonly` **checkpointedAt**: `number`

Defined in: [src/core/runCheckpoint.ts:76](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L76)

Wall-clock when the checkpoint was captured. Diagnostic only.

***

### failurePoint?

> `readonly` `optional` **failurePoint?**: `object`

Defined in: [src/core/runCheckpoint.ts:80](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L80)

Where the failure happened. Diagnostic — surfaces in oncall
 triage so you can tell "LLM 500 mid-iteration" from "tool
 threw" from "validation kept failing".

#### iteration

> `readonly` **iteration**: `number`

#### phase

> `readonly` **phase**: `"tool"` \| `"llm"` \| `"iteration"` \| `"unknown"`

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/runCheckpoint.ts:68](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L68)

Conversation history at the LAST completed iteration boundary
 (LLM messages). The next iteration retries from here.

***

### lastCompletedIteration

> `readonly` **lastCompletedIteration**: `number`

Defined in: [src/core/runCheckpoint.ts:71](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L71)

Index of the last completed iteration (0-based). The resumed
 run starts at iteration `lastCompletedIteration + 1`.

***

### originalInput

> `readonly` **originalInput**: `object`

Defined in: [src/core/runCheckpoint.ts:74](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L74)

Original input message. Surfaces in observability + lets the
 consumer correlate checkpoint to the user's request.

#### message

> `readonly` **message**: `string`

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/runCheckpoint.ts:65](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L65)

Original `runId` from the failing run. Reused on resume so
 observability + cost tracking correlates the resumed iterations
 back to the original run.

***

### version

> `readonly` **version**: `1`

Defined in: [src/core/runCheckpoint.ts:61](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/runCheckpoint.ts#L61)

Schema version. v1 = conversation-history-based.
