---
title: RunTurn
---

# Interface: RunTurn

Defined in: [src/core/agent/aroundTurn/types.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L15)

A new turn: what `run`, `runTyped`, `followUp`, `resumeOnError` and a hosted
message hand the agent. A read-only copy — editing it fails, and could not
reach the run. The one change a wrapper may ask for is [TurnChanges](/docs/api/interfaces/TurnChanges).

## Properties

### input

> `readonly` **input**: `string` \| [`AgentInput`](/docs/api/interfaces/AgentInput)

Defined in: [src/core/agent/aroundTurn/types.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L17)

***

### kind

> `readonly` **kind**: `"run"`

Defined in: [src/core/agent/aroundTurn/types.ts:16](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L16)

***

### options

> `readonly` **options**: `AgentRunOptions` \| `undefined`

Defined in: [src/core/agent/aroundTurn/types.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/aroundTurn/types.ts#L18)
