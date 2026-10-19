---
title: sessionArtifactAdmission
---

# Function: sessionArtifactAdmission()

> **sessionArtifactAdmission**(`options`): [`SessionArtifactAdmission`](/docs/api/type-aliases/SessionArtifactAdmission)

Defined in: [src/tools/sessionArtifactAdmission.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sessionArtifactAdmission.ts#L151)

Admit one stored record using this call's existing scope-bound capability.

Requires an actual session and store, an exact kind allowlist and a payload
ceiling of at most 1 MiB. Metadata has a separate 16 KiB ceiling. Every call
reads head/get afresh, detaches/freezes ordinary JSON, checks metadata and
actual canonical byte counts, then runs the optional narrowing check.
These bounds govern admitted snapshots, not the backend's earlier allocations:
existing file/SQLite head/get paths may load a whole payload before returning.

This composes no identity or scope, caches no authority, opens no parent,
and proves no producer, current-run origin, domain meaning or source truth.
Optional digest verification belongs to the store's get implementation.
Callback/store failures have fixed refusal text; cancellation stops waiting
and never delivers a late result, without promising the underlying work stops.

## Parameters

### options

[`SessionArtifactAdmissionOptions`](/docs/api/interfaces/SessionArtifactAdmissionOptions)

## Returns

[`SessionArtifactAdmission`](/docs/api/type-aliases/SessionArtifactAdmission)
