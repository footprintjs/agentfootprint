---
title: ScriptTravelOptions
---

# Interface: ScriptTravelOptions

Defined in: [src/core/agent/scripts/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L86)

`.scriptTravelsWithTheAnswer()` options.

## Properties

### maxBytes?

> `readonly` `optional` **maxBytes?**: `number`

Defined in: [src/core/agent/scripts/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L97)

UTF-8 bytes of each program shown (default 4,000). A longer program is
cut at a code-point boundary and says it is incomplete.

***

### which?

> `readonly` `optional` **which?**: `"all"` \| `"last"`

Defined in: [src/core/agent/scripts/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L92)

`'last'` (default) — the last call of the turn that reached the tool;
`'all'` — every call of the turn that reached it, at most
`MAX_ATTACHED_SCRIPTS`, the rest counted as `omitted`.
