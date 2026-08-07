[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentRunCheckpoint

# Interface: AgentRunCheckpoint

Defined in: [src/core/runCheckpoint.ts:70](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L70)

JSON-serializable checkpoint of an in-progress agent run. Persist
to ANY durable store (Redis / Postgres / S3 / disk / queue) and
resume hours / days / deploys later via `agent.resumeOnError(...)`.

**Stable shape** — the `version` field guards forward compat. v1
→ v2 transitions will be supported via a migration helper.

## Properties

### checkpointedAt

> `readonly` **checkpointedAt**: `number`

Defined in: [src/core/runCheckpoint.ts:90](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L90)

Wall-clock when the checkpoint was captured. Diagnostic only.

***

### failurePoint?

> `readonly` `optional` **failurePoint?**: `object`

Defined in: [src/core/runCheckpoint.ts:117](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L117)

Where the failure happened. Diagnostic — surfaces in oncall
 triage so you can tell "LLM 500 mid-iteration" from "tool
 threw" from "validation kept failing".

#### iteration

> `readonly` **iteration**: `number`

#### phase

> `readonly` **phase**: `"tool"` \| `"iteration"` \| `"llm"` \| `"unknown"`

#### stage?

> `readonly` `optional` **stage?**: `string`

What was OPEN when it threw — `'call-llm'` for the model call, or the
declared name of the tool that was running (8.14.0).

Absent when nothing was open (a failure between brackets), which is the
honest answer rather than a guess.

**Never a URL, never a credential, never request or response content.**
Only the literal string `'call-llm'` or a tool name the app itself
declared. A checkpoint is persisted to Redis / Postgres / S3 and read by
whoever is on call; nothing that could carry a secret goes in it. Do not
"improve" this field into carrying the endpoint.

***

### folded?

> `readonly` `optional` **folded?**: readonly [`FoldedSpan`](/agentfootprint/api/generated/interfaces/FoldedSpan.md)[]

Defined in: [src/core/runCheckpoint.ts:113](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L113)

Every span this conversation folded into a summary, oldest first — what
makes a compacted conversation still a provable one after the process
that compacted it is gone.

Written by `.compaction()`; absent on a conversation that never folded,
and absent on one stored by a runtime older than 8.2. Under the default
`retain: 'conversation'` each span carries the folded messages verbatim;
under `retain: 'discard'` the span is still here, naming what left, and
only `messages` is absent.

Join a summary in [history](/agentfootprint/api/generated/interfaces/AgentRunCheckpoint.md#history) to its span with `foldedSpanFor(...)` —
by content fingerprint, never by index, because a later fold moves every
index after it.

**Version 1 still, deliberately.** An optional field is not a format
change: a runtime that has never heard of `folded` reads this checkpoint,
ignores it, and continues the conversation correctly — the summary is an
ordinary message in `history` either way. Bumping the version would make
an older deployment REFUSE a session it can serve perfectly well, which is
the opposite of what the version field is for.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/runCheckpoint.ts:80](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L80)

Conversation history at the LAST completed iteration boundary
 (LLM messages). The next iteration retries from here.

***

### lastCompletedIteration

> `readonly` **lastCompletedIteration**: `number`

Defined in: [src/core/runCheckpoint.ts:85](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L85)

Index of the last completed iteration in the FAILING run
 (diagnostic — not consumed on resume). The resumed run restores
 this history but re-seeds its own iteration counter at 1 with a
 full `maxIterations` budget.

***

### originalInput

> `readonly` **originalInput**: `object`

Defined in: [src/core/runCheckpoint.ts:88](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L88)

Original input message. Surfaces in observability + lets the
 consumer correlate checkpoint to the user's request.

#### message

> `readonly` **message**: `string`

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/runCheckpoint.ts:77](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L77)

`runId` of the FAILING run — lets the consumer correlate a
 persisted checkpoint back to the original run's observability.
 NOT reused on resume: `resumeOnError` starts a fresh run with a
 fresh `runId` (only the conversation history is restored).

***

### version

> `readonly` **version**: `1`

Defined in: [src/core/runCheckpoint.ts:72](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/runCheckpoint.ts#L72)

Schema version. v1 = conversation-history-based.
