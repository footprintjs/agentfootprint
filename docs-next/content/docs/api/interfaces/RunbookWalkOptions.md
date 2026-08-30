---
title: RunbookWalkOptions
---

# Interface: RunbookWalkOptions

Defined in: [src/core/runbook/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L88)

The walk policy.

## Properties

### cap?

> `readonly` `optional` **cap?**: `number`

Defined in: [src/core/runbook/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L91)

Row cap on the minted walk (default 500). When the full walk does not
 fit, the CONTROL FLOW survives — see `walk.ts` for the projection law.

***

### recording?

> `readonly` `optional` **recording?**: `boolean` \| [`RunbookRecordingOptions`](/docs/api/interfaces/RunbookRecordingOptions)

Defined in: [src/core/runbook/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L130)

ALSO file the inner chart's own RECORDING (9.79.0) — `{ snapshot, events,
structure }`, the shape `observeRecording()` mounts — under kind
`'recording/run'`, and put its ref on the spine as
`result.walk.recording_ref`.

`true` for the defaults, or `{ label, maxBytes }` to set them yourself.

── Off by default, and why that is not timidity ─────────────────────────
The walk is a PROJECTION: eight declared columns per row, values off by
construction (`narrative({ includeValues: false })`), so a walk carries
sentences about what happened and no payload from it. A recording is the
run: the chart's shared state, its whole commit log, and every attached
recorder's data. Filing one is a materially bigger promise — it carries
whatever the chart WROTE — so it is a thing an operator declares, never a
thing a library starts doing to them. Unset, not one extra line runs: no
second snapshot is taken, no bytes are measured, no store call is made,
and the envelope is byte-identical to 9.78.0.

── What it buys ────────────────────────────────────────────────────────
The row projection cannot be drawn. `structure` — the chart's build-time
graph — is the only route to a drawable flowchart, and no snapshot carries
it; a consumer handed 129 rows can only correctly REFUSE to infer the step
graph from them. With the recording filed, the lens/explainable-UI flow
components mount the runbook's walk as the flowchart it actually ran.

── Redaction, once, for both ───────────────────────────────────────────
The recording's snapshot is read from the REDACTED MIRROR
(`getSnapshot({ redact: true })`), so the `redact` policy that scrubs the
walk scrubs the recording by the same rule at the same moment. One policy,
one meaning, both artifacts.

── Best-effort, and the absence is STATED ──────────────────────────────
`mintWalk`'s own law: no store, an over-size refusal, or a failed mint
costs the REF, never the answer — and `walk.recording_note` says which,
so a reader never has to guess why a ref is missing. With this option
unset, the descriptor says nothing about a recording at all.
