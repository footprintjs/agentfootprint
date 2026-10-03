---
title: GroundedRow
---

# Interface: GroundedRow

Defined in: src/core/agent/assessment/witness.ts:55

The evidence gate's CLEAN verdict on the answer (`action: 'grounded'` on
`agentfootprint.agent.evidence_checked`): every name and number the answer
states was found in a tool result, or was exempt. Filed by the Route decider
on the turn's answer while the answer layer is armed. A flagged or refused
verdict needs no witness row — `AgentState.unsupportedValues` is already
committed.

The fold reads it as the names-and-numbers check having RUN on this answer —
never as support: finding a value in a tool result is a membership pass, and
a membership pass never makes an answer "known".

## Properties

### afterRevision?

> `readonly` `optional` **afterRevision?**: `true`

Defined in: src/core/agent/assessment/witness.ts:68

Set when the grounded answer was the one revision the gate asked for.

***

### candidates

> `readonly` **candidates**: `number`

Defined in: src/core/agent/assessment/witness.ts:64

How many distinct values the answer had to ground, exempt ones included.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/assessment/witness.ts:60

The iteration whose answer the gate judged.

***

### kind

> `readonly` **kind**: `"grounded"`

Defined in: src/core/agent/assessment/witness.ts:56

***

### lookedUp

> `readonly` **lookedUp**: `number`

Defined in: src/core/agent/assessment/witness.ts:66

How many of `candidates` the gate looked up in the tool results (the rest were exempt).

***

### posture

> `readonly` **posture**: `WitnessPosture`

Defined in: src/core/agent/assessment/witness.ts:62

The posture in force.

***

### turn

> `readonly` **turn**: `number`

Defined in: src/core/agent/assessment/witness.ts:58

`AgentState.turnNumber` when the row was filed — the conversation turn.
