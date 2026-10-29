---
title: ScriptTravelOptions
---

# Interface: ScriptTravelOptions

Defined in: [src/core/agent/scripts/types.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L78)

`.scriptTravelsWithTheAnswer()` options.

## Properties

### maxBytes?

> `readonly` `optional` **maxBytes?**: `number`

Defined in: [src/core/agent/scripts/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L89)

UTF-8 bytes of each program shown (default 4,000). A longer program is
cut at a code-point boundary and says it is incomplete.

***

### which?

> `readonly` `optional` **which?**: `"all"` \| `"last"`

Defined in: [src/core/agent/scripts/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L84)

`'last'` (default) — the last call of the turn that reached the tool;
`'all'` — every call of the turn that reached it, at most
`MAX_ATTACHED_SCRIPTS`, the rest counted as `omitted`.
