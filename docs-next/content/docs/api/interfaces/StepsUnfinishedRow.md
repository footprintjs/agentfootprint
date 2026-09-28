---
title: StepsUnfinishedRow
---

# Interface: StepsUnfinishedRow

Defined in: [src/core/agent/assessment/witness.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L88)

The answer came before the active skill's declared steps finished
(`agentfootprint.skill.steps_unfinished` with `action: 'accepted'` — the one
teaching nudge was already spent — or `'cut-short'` — a limit forced the
answer). Filed by the Route decider while the answer layer is armed, and
only for the answer that STANDS: the step judge runs before the evidence
gate, so a stop it accepted on a draft the gate then sends back files no row
(the event still fires) — the revision is judged again, and at most one row
per answer reaches the ledger. The `'nudged'` verdict needs no row: the turn
went on.

## Properties

### action

> `readonly` **action**: `"accepted"` \| `"cut-short"`

Defined in: [src/core/agent/assessment/witness.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L100)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/assessment/witness.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L93)

The iteration whose answer the step judge read.

***

### kind

> `readonly` **kind**: `"steps-unfinished"`

Defined in: [src/core/agent/assessment/witness.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L89)

***

### remaining

> `readonly` **remaining**: readonly `UnfinishedStep`[]

Defined in: [src/core/agent/assessment/witness.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L97)

The declared steps not reached, in order — position and tool only.

***

### skillId

> `readonly` **skillId**: `string`

Defined in: [src/core/agent/assessment/witness.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L95)

The skill whose procedure was in progress.

***

### total

> `readonly` **total**: `number`

Defined in: [src/core/agent/assessment/witness.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L99)

How many steps the procedure declares.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/assessment/witness.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L91)

`AgentState.turnNumber` when the row was filed — the conversation turn.
