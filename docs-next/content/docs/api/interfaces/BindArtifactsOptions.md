---
title: BindArtifactsOptions
---

# Interface: BindArtifactsOptions

Defined in: src/artifacts/capability.ts:102

What `bindArtifacts` needs beyond the store and the scope.

## Properties

### onEvent?

> `readonly` `optional` **onEvent?**: [`ArtifactEventSink`](/docs/api/type-aliases/ArtifactEventSink)

Defined in: src/artifacts/capability.ts:106

Fact sink. Absent = silent binding (raw store semantics, no record).

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/docs/api/interfaces/ArtifactOrigin)

Defined in: src/artifacts/capability.ts:104

Stamped onto every mint — the run's own facts, absent when unknown.
