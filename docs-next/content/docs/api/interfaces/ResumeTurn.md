---
title: ResumeTurn
---

# Interface: ResumeTurn

Defined in: [src/core/agent/aroundTurn/types.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L29)

A paused turn being answered: what `resume` and a hosted answer hand the
agent. A read-only copy. A resume accepts no change: the paused turn keeps
its clock and its caller.

## Properties

### answer

> `readonly` **answer**: `unknown`

Defined in: [src/core/agent/aroundTurn/types.ts:32](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L32)

***

### checkpoint

> `readonly` **checkpoint**: `FlowchartCheckpoint`

Defined in: [src/core/agent/aroundTurn/types.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L31)

***

### kind

> `readonly` **kind**: `"resume"`

Defined in: [src/core/agent/aroundTurn/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L30)

***

### options

> `readonly` **options**: `AgentRunOptions` \| `undefined`

Defined in: [src/core/agent/aroundTurn/types.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L33)
