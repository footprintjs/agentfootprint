---
title: BindArtifactsOptions
---

# Interface: BindArtifactsOptions

Defined in: src/artifacts/capability.ts:102

What `bindArtifacts` needs beyond the store and the scope.

## Properties

### onEvent?

> `readonly` `optional` **onEvent?**: [`ArtifactEventSink`](/docs/api/type-aliases/ArtifactEventSink)

Defined in: src/artifacts/capability.ts:108

Fact sink. Absent = silent binding (raw store semantics, no record).

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/docs/api/interfaces/ArtifactOrigin)

Defined in: src/artifacts/capability.ts:106

Stamped onto every mint — the run's own facts, absent when unknown. A
 caller-supplied `origin` is dropped either way: with none here, a mint
 carries no origin at all.
