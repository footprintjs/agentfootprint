---
title: AgentRunCheckpoint
---

# Interface: AgentRunCheckpoint

Defined in: [src/core/runCheckpoint.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L69)

JSON-serializable checkpoint of an in-progress agent run. Persist
to ANY durable store (Redis / Postgres / S3 / disk / queue) and
resume hours / days / deploys later via `agent.resumeOnError(...)`.

**Stable shape** — the `version` field guards forward compat. v1
→ v2 transitions will be supported via a migration helper.

## Properties

### checkpointedAt

> `readonly` **checkpointedAt**: `number`

Defined in: [src/core/runCheckpoint.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L89)

Wall-clock when the checkpoint was captured. Diagnostic only.

***

### failurePoint?

> `readonly` `optional` **failurePoint?**: `object`

Defined in: [src/core/runCheckpoint.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L93)

Where the failure happened. Diagnostic — surfaces in oncall
 triage so you can tell "LLM 500 mid-iteration" from "tool
 threw" from "validation kept failing".

#### iteration

> `readonly` **iteration**: `number`

#### phase

> `readonly` **phase**: `"tool"` \| `"llm"` \| `"iteration"` \| `"unknown"`

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/runCheckpoint.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L79)

Conversation history at the LAST completed iteration boundary
 (LLM messages). The next iteration retries from here.

***

### lastCompletedIteration

> `readonly` **lastCompletedIteration**: `number`

Defined in: [src/core/runCheckpoint.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L84)

Index of the last completed iteration in the FAILING run
 (diagnostic — not consumed on resume). The resumed run restores
 this history but re-seeds its own iteration counter at 1 with a
 full `maxIterations` budget.

***

### originalInput

> `readonly` **originalInput**: `object`

Defined in: [src/core/runCheckpoint.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L87)

Original input message. Surfaces in observability + lets the
 consumer correlate checkpoint to the user's request.

#### message

> `readonly` **message**: `string`

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/runCheckpoint.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L76)

`runId` of the FAILING run — lets the consumer correlate a
 persisted checkpoint back to the original run's observability.
 NOT reused on resume: `resumeOnError` starts a fresh run with a
 fresh `runId` (only the conversation history is restored).

***

### version

> `readonly` **version**: `1`

Defined in: [src/core/runCheckpoint.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runCheckpoint.ts#L71)

Schema version. v1 = conversation-history-based.
