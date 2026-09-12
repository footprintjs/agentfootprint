---
title: FlowBreakEvent
---

# Interface: FlowBreakEvent

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:250

Event passed to FlowRecorder.onBreak.

## Properties

### propagatedFromSubflow?

> `optional` **propagatedFromSubflow?**: `string`

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:266

When true, this break event was raised on the PARENT because an inner
subflow's break propagated up (via `SubflowMountOptions.propagateBreak`).
The originating inner break fires its own `onBreak` event separately
— this flag lets recorders distinguish the two.

***

### reason?

> `optional` **reason?**: `string`

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:259

Optional free-form reason supplied by `scope.$break(reason)`. Absent
when the stage invoked `$break()` without an argument. Propagates when
a subflow is mounted with `propagateBreak: true` — the outer break
event carries the inner break's reason too.

***

### stageName

> **stageName**: `string`

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:251

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:252
