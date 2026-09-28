---
title: StepsUnfinishedRow
---

# Interface: StepsUnfinishedRow

Defined in: [src/core/agent/assessment/witness.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L84)

The answer came before the active skill's declared steps finished
(`agentfootprint.skill.steps_unfinished` with `action: 'accepted'` — the one
teaching nudge was already spent — or `'cut-short'` — a limit forced the
answer). Filed by the Route decider on the turn's answer while the answer
layer is armed. The `'nudged'` verdict needs no row: the turn went on.

## Properties

### action

> `readonly` **action**: `"accepted"` \| `"cut-short"`

Defined in: [src/core/agent/assessment/witness.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L96)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/assessment/witness.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L89)

The iteration whose answer the step judge read.

***

### kind

> `readonly` **kind**: `"steps-unfinished"`

Defined in: [src/core/agent/assessment/witness.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L85)

***

### remaining

> `readonly` **remaining**: readonly `UnfinishedStep`[]

Defined in: [src/core/agent/assessment/witness.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L93)

The declared steps not reached, in order — position and tool only.

***

### skillId

> `readonly` **skillId**: `string`

Defined in: [src/core/agent/assessment/witness.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L91)

The skill whose procedure was in progress.

***

### total

> `readonly` **total**: `number`

Defined in: [src/core/agent/assessment/witness.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L95)

How many steps the procedure declares.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/assessment/witness.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L87)

`AgentState.turnNumber` when the row was filed — the conversation turn.
