[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BindArtifactsOptions

# Interface: BindArtifactsOptions

Defined in: [src/artifacts/capability.ts:102](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/capability.ts#L102)

What `bindArtifacts` needs beyond the store and the scope.

## Properties

### onEvent?

> `readonly` `optional` **onEvent?**: [`ArtifactEventSink`](/agentfootprint/api/generated/type-aliases/ArtifactEventSink.md)

Defined in: [src/artifacts/capability.ts:106](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/capability.ts#L106)

Fact sink. Absent = silent binding (raw store semantics, no record).

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/agentfootprint/api/generated/interfaces/ArtifactOrigin.md)

Defined in: [src/artifacts/capability.ts:104](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/capability.ts#L104)

Stamped onto every mint — the run's own facts, absent when unknown.
