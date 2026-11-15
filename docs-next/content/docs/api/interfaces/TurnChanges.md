---
title: TurnChanges
---

# Interface: TurnChanges

Defined in: [src/core/agent/aroundTurn/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L46)

The closed set of changes `proceed` accepts, on a `run` turn only.

`time` takes the path `run({ time })` takes, so the clock row is the normal
one. A field the wrapper names wins; a field it leaves out stays the
caller's (`input.time`, else `options.time`).

## Properties

### time?

> `readonly` `optional` **time?**: [`RunTime`](/docs/api/interfaces/RunTime)

Defined in: [src/core/agent/aroundTurn/types.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L47)
