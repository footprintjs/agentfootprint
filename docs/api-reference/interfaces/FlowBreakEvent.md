[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowBreakEvent

# Interface: FlowBreakEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:222

Event passed to FlowRecorder.onBreak.

## Properties

### propagatedFromSubflow?

> `optional` **propagatedFromSubflow?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:238

When true, this break event was raised on the PARENT because an inner
subflow's break propagated up (via `SubflowMountOptions.propagateBreak`).
The originating inner break fires its own `onBreak` event separately
— this flag lets recorders distinguish the two.

***

### reason?

> `optional` **reason?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:231

Optional free-form reason supplied by `scope.$break(reason)`. Absent
when the stage invoked `$break()` without an argument. Propagates when
a subflow is mounted with `propagateBreak: true` — the outer break
event carries the inner break's reason too.

***

### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:223

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/agentfootprint/api/generated/interfaces/TraversalContext.md)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:224
