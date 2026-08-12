[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentRunCheckpoint

# Interface: AgentRunCheckpoint

Defined in: [src/core/runCheckpoint.ts:75](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L75)

JSON-serializable checkpoint of an in-progress agent run. Persist
to ANY durable store (Redis / Postgres / S3 / disk / queue) and
resume hours / days / deploys later via `agent.resumeOnError(...)`.

**Stable shape** — the `version` field guards forward compat. v1
→ v2 transitions will be supported via a migration helper.

## Properties

### agent?

> `readonly` `optional` **agent?**: `object`

Defined in: [src/core/runCheckpoint.ts:160](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L160)

WHICH agent recorded this conversation — present only when that agent was
given an explicit `Agent.create({ id })` (9.2.0).

A conversation is a transcript, and a transcript can be replayed on any
agent. Usually that is the point: a deploy that adds a tool or edits a
prompt must still be able to continue yesterday's conversations, so the
runtime cannot refuse on "the agent changed". But replaying the BILLING
agent's conversation on the SUPPORT agent is a different mistake, and it
used to be accepted in silence.

The rule is the one the embedder fingerprint already uses: **ids decide
only when BOTH sides named themselves.** A default id (`'agent'`) is not
naming yourself, so the majority of callers — who never pass one — are
never refused. Two sides that both chose a name and chose different ones
are refused, by name.

Version 1 still, for the same reason as the two fields above.

#### id

> `readonly` **id**: `string`

***

### checkpointedAt

> `readonly` **checkpointedAt**: `number`

Defined in: [src/core/runCheckpoint.ts:95](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L95)

Wall-clock when the checkpoint was captured. Diagnostic only.

***

### failurePoint?

> `readonly` `optional` **failurePoint?**: `object`

Defined in: [src/core/runCheckpoint.ts:164](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L164)

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

Defined in: [src/core/runCheckpoint.ts:118](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L118)

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

Defined in: [src/core/runCheckpoint.ts:85](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L85)

Conversation history at the LAST completed iteration boundary
 (LLM messages). The next iteration retries from here.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/runCheckpoint.ts:140](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L140)

WHO this conversation belongs to — the `identity` the stored run was
given, carried so that continuing it lands in the same namespace it
started in (9.2.0).

Before this field, continuing a conversation re-seeded identity from the
resuming run's own id: every continued turn wrote its memory under a
FRESH `conversationId`, so turn two's facts were stored somewhere turn
three could not read them. Nothing threw, and the only symptom was an
agent that kept forgetting — the same class of failure as a store that
silently forgot everything looking exactly like a new user.

Absent on a conversation stored before 9.2.0, and absent when the run
never got an explicit identity (the default is derived from a runId, and
carrying THAT forward would pin a whole conversation to one run's id).
An explicit `identity` on the continuing call always wins.

**Version 1 still**, on the same reasoning as [folded](/agentfootprint/api/generated/interfaces/AgentRunCheckpoint.md#folded): an optional
field is not a format change, and a runtime that has never heard of it
continues the conversation correctly.

***

### lastCompletedIteration

> `readonly` **lastCompletedIteration**: `number`

Defined in: [src/core/runCheckpoint.ts:90](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L90)

Index of the last completed iteration in the FAILING run
 (diagnostic — not consumed on resume). The resumed run restores
 this history but re-seeds its own iteration counter at 1 with a
 full `maxIterations` budget.

***

### originalInput

> `readonly` **originalInput**: `object`

Defined in: [src/core/runCheckpoint.ts:93](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L93)

Original input message. Surfaces in observability + lets the
 consumer correlate checkpoint to the user's request.

#### message

> `readonly` **message**: `string`

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/runCheckpoint.ts:82](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L82)

`runId` of the FAILING run — lets the consumer correlate a
 persisted checkpoint back to the original run's observability.
 NOT reused on resume: `resumeOnError` starts a fresh run with a
 fresh `runId` (only the conversation history is restored).

***

### version

> `readonly` **version**: `1`

Defined in: [src/core/runCheckpoint.ts:77](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/runCheckpoint.ts#L77)

Schema version. v1 = conversation-history-based.
