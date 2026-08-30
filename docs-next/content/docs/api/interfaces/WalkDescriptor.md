---
title: WalkDescriptor
---

# Interface: WalkDescriptor

Defined in: [src/core/runbook/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L218)

The recorded-walk descriptor — ALWAYS on the spine. The walk itself ships
as an artifact ticket (`ref`), never as bytes in the envelope; with no
store attached (or a failed mint) the descriptor still states its
counters and the `note` names why there is no ticket — a missing walk must
never be mistaken for a short run.

## Properties

### complete

> `readonly` **complete**: `boolean`

Defined in: [src/core/runbook/types.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L235)

***

### kind?

> `readonly` `optional` **kind?**: `string`

Defined in: [src/core/runbook/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L223)

The artifact kind (`'recording/chart-walk'`). Present with `ref`.

***

### note

> `readonly` **note**: `string`

Defined in: [src/core/runbook/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L246)

The human sentence: what the walk is, and (when projected) what the
 control-flow projection kept and dropped, or why there is no ticket.

***

### projection

> `readonly` **projection**: `"full"` \| `"control-flow"`

Defined in: [src/core/runbook/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L232)

`'full'` — every narrative entry fit under the cap; `'control-flow'` —
 it did not, and the stages/forks/subflows/decisions survived while the
 per-key reads and writes were dropped.

***

### recording\_bytes?

> `readonly` `optional` **recording\_bytes?**: `number`

Defined in: [src/core/runbook/types.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L268)

The recording's size in bytes. Present on the SUCCESS path (the store's
own measurement) AND on the over-size refusal (what it measured, beside
the ceiling it broke) — the one number that makes a size decision
checkable instead of mysterious.

***

### recording\_kind?

> `readonly` `optional` **recording\_kind?**: `string`

Defined in: [src/core/runbook/types.ts:261](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L261)

The recording's artifact kind (`'recording/run'`). Present with
 `recording_ref`.

***

### recording\_note?

> `readonly` `optional` **recording\_note?**: `string`

Defined in: [src/core/runbook/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L275)

The human sentence about the recording: what a filed one CONTAINS beyond
the walk's row projection, or the named reason there is no
`recording_ref`. Present whenever a recording was asked for — silence is
not an allowed answer to "why is the ref missing".

***

### recording\_ref?

> `readonly` `optional` **recording\_ref?**: `string`

Defined in: [src/core/runbook/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L258)

The claim-ticket ref of the inner chart's own `{ snapshot, events,
structure }` recording — what the lens/explainable-UI flow components
mount to draw this walk as the flowchart it ran. Absent when the mint was
refused or failed; `recording_note` says which, and never stays silent.

***

### ref?

> `readonly` `optional` **ref?**: `string`

Defined in: [src/core/runbook/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L221)

The claim-ticket ref of the minted walk artifact. Absent when no store
 is attached or the mint failed — `note` says which.

***

### rows

> `readonly` **rows**: `number`

Defined in: [src/core/runbook/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L225)

Rows in the minted artifact.

***

### shown

> `readonly` **shown**: `number`

Defined in: [src/core/runbook/types.ts:233](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L233)

***

### steps\_executed

> `readonly` **steps\_executed**: `number`

Defined in: [src/core/runbook/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L228)

Total execution steps the narrative recorder counted — spans isolated
 subflow logs, which the root commit log cannot.

***

### total

> `readonly` **total**: `number`

Defined in: [src/core/runbook/types.ts:234](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L234)

***

### walk\_segment

> `readonly` **walk\_segment**: `"full"` \| `"pre-pause"` \| `"post-resume"`

Defined in: [src/core/runbook/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L243)

WHICH SEGMENT of the run this walk covers. `'full'` for an un-gated run
(all of phase 1). When approval gates land, a resumed run's recorders
start empty on the fresh executor — its walk will say `'post-resume'`
and its counters will count only that segment; the discriminant ships
NOW so the wire does not break then.
