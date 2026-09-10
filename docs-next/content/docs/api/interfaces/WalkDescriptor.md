---
title: WalkDescriptor
---

# Interface: WalkDescriptor

Defined in: [src/core/runbook/types.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L235)

The recorded-walk descriptor — ALWAYS on the spine. The walk itself ships
as an artifact ticket (`ref`), never as bytes in the envelope; with no
store attached (or a failed mint) the descriptor still states its
counters and the `note` names why there is no ticket — a missing walk must
never be mistaken for a short run.

## Properties

### complete

> `readonly` **complete**: `boolean`

Defined in: [src/core/runbook/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L252)

***

### kind?

> `readonly` `optional` **kind?**: `string`

Defined in: [src/core/runbook/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L240)

The artifact kind (`'recording/chart-walk'`). Present with `ref`.

***

### note

> `readonly` **note**: `string`

Defined in: [src/core/runbook/types.ts:263](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L263)

The human sentence: what the walk is, and (when projected) what the
 control-flow projection kept and dropped, or why there is no ticket.

***

### projection

> `readonly` **projection**: `"full"` \| `"control-flow"`

Defined in: [src/core/runbook/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L249)

`'full'` — every narrative entry fit under the cap; `'control-flow'` —
 it did not, and the stages/forks/subflows/decisions survived while the
 per-key reads and writes were dropped.

***

### recording\_bytes?

> `readonly` `optional` **recording\_bytes?**: `number`

Defined in: [src/core/runbook/types.ts:285](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L285)

The recording's size in bytes. Present on the SUCCESS path (the store's
own measurement) AND on the over-size refusal (what it measured, beside
the ceiling it broke) — the one number that makes a size decision
checkable instead of mysterious.

***

### recording\_kind?

> `readonly` `optional` **recording\_kind?**: `string`

Defined in: [src/core/runbook/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L278)

The recording's artifact kind (`'recording/run'`). Present with
 `recording_ref`.

***

### recording\_note?

> `readonly` `optional` **recording\_note?**: `string`

Defined in: [src/core/runbook/types.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L292)

The human sentence about the recording: what a filed one CONTAINS beyond
the walk's row projection, or the named reason there is no
`recording_ref`. Present whenever a recording was asked for — silence is
not an allowed answer to "why is the ref missing".

***

### recording\_ref?

> `readonly` `optional` **recording\_ref?**: `string`

Defined in: [src/core/runbook/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L275)

The claim-ticket ref of the inner chart's own `{ snapshot, events,
structure }` recording — what the lens/explainable-UI flow components
mount to draw this walk as the flowchart it ran. Absent when the mint was
refused or failed; `recording_note` says which, and never stays silent.

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/runbook/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L238)

The claim-ticket ref of the minted walk artifact. Absent when no store
 is attached or the mint failed — `note` says which.

***

### rows

> `readonly` **rows**: `number`

Defined in: [src/core/runbook/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L242)

Rows in the minted artifact.

***

### shown

> `readonly` **shown**: `number`

Defined in: [src/core/runbook/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L250)

***

### steps\_executed

> `readonly` **steps\_executed**: `number`

Defined in: [src/core/runbook/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L245)

Total execution steps the narrative recorder counted — spans isolated
 subflow logs, which the root commit log cannot.

***

### total

> `readonly` **total**: `number`

Defined in: [src/core/runbook/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L251)

***

### walk\_segment

> `readonly` **walk\_segment**: `"full"` \| `"pre-pause"` \| `"post-resume"`

Defined in: [src/core/runbook/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L260)

WHICH SEGMENT of the run this walk covers. `'full'` for an un-gated run
(all of phase 1). When approval gates land, a resumed run's recorders
start empty on the fresh executor — its walk will say `'post-resume'`
and its counters will count only that segment; the discriminant ships
NOW so the wire does not break then.
