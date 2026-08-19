[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentArtifactsOptions

# Interface: AgentArtifactsOptions

Defined in: [src/core/agent/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/types.ts#L70)

The object form of `AgentOptions.artifacts` (9.22.0): the store plus its
operator dials. `placement` cannot be spelled without `store` — a
threshold with nowhere to put what it catches would be configuration that
lies, and the shape refuses it before a runtime check has to.

## Properties

### placement?

> `readonly` `optional` **placement?**: [`ArtifactPlacement`](/agentfootprint/api/generated/interfaces/ArtifactPlacement.md)

Defined in: [src/core/agent/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/types.ts#L82)

The placement threshold. A tool result whose finalized text exceeds
`maxInlineChars` is checked into the store (kind
`tool-result/<toolName>`) and the model reads the claim ticket instead.
Judged AFTER the tool's own `resultCeiling` (the author's refusal comes
first) and BEFORE the agent-level `maxToolResultChars` truncation net
(which then measures the ticket, so it should rarely fire). Omitted →
results are never measured and never placed, exactly as before.

***

### recordings?

> `readonly` `optional` **recordings?**: `boolean` \| [`AgentRecordingsOptions`](/agentfootprint/api/generated/interfaces/AgentRecordingsOptions.md)

Defined in: [src/core/agent/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/types.ts#L120)

Check each completed run's RECORDING into the store (9.26.0), so a screen
can replay the turn later without the deployment inventing a place to keep
it.

`true` for the default naming, or `{ label }` to name them yourself. Off by
default: unset, no recorder is attached, no events are captured, and the
run is byte-identical to every earlier release.

── What lands, and where ───────────────────────────────────────────────
The `recordRun` contract exactly — `{ snapshot, events, structure }`, the
three things a viewer needs and the shape `observeRecording()` consumes —
minted as kind `'recording/run'` in the RUN's own artifact scope, with
`origin.runId` joining it back to the trace. The existing wire ops serve
it: `{ op: 'artifact-get', ref }` returns the recording, and no new
operation was needed for any of it. Retention rides the store, so
recordings age out under the same ttl and byte budget everything else
does.

── The cost, stated rather than discovered ─────────────────────────────
Recording a run means an event tail and a boundary recorder for its
duration, and the mint is one store write on the way OUT of `run()` — the
answer is fully composed before the write begins and the write can never
change it, but `run()` does return after it rather than before. That is
deliberate: a fire-and-forget write is a recording lost whenever the
container exits with the reply, which is exactly the deployment that wants
this most.

A mint that FAILS degrades to the old behaviour — the answer is returned
unchanged, and the failure lands on the record as
`agentfootprint.artifacts.refused`. A run never fails because its
recording could not be filed.

Nothing is minted for a run that paused (there is no completed run yet) or
threw. A resumed run mints when it completes, and its recording covers the
RESUMED run — which is what the recorder saw.

***

### store

> `readonly` **store**: [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

Defined in: [src/core/agent/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/types.ts#L72)

The claim-check store — same seam as the bare `ArtifactStore` form.
