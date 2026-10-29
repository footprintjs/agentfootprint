---
title: StepsUnfinishedRow
---

# Interface: StepsUnfinishedRow

Defined in: [src/core/agent/assessment/witness.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L99)

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

Defined in: [src/core/agent/assessment/witness.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L111)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/assessment/witness.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L104)

The iteration whose answer the step judge read.

***

### kind

> `readonly` **kind**: `"steps-unfinished"`

Defined in: [src/core/agent/assessment/witness.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L100)

***

### remaining

> `readonly` **remaining**: readonly `UnfinishedStep`[]

Defined in: [src/core/agent/assessment/witness.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L108)

The declared steps not reached, in order — position and tool only.

***

### skillId

> `readonly` **skillId**: `string`

Defined in: [src/core/agent/assessment/witness.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L106)

The skill whose procedure was in progress.

***

### total

> `readonly` **total**: `number`

Defined in: [src/core/agent/assessment/witness.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L110)

How many steps the procedure declares.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/assessment/witness.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L102)

`AgentState.turnNumber` when the row was filed — the conversation turn.
