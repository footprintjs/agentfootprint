---
title: ScriptShownRow
---

# Interface: ScriptShownRow

Defined in: [src/core/agent/assessment/witness.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L120)

One fenced block the answer SHOWED, and the script match's verdict on it
(`.namesAndNumbersFromEvidence({ code: 'match' })`, `scripts/match.ts`) —
filed by the Route decider while the answer layer is armed, one row per
block read, and only for the answer that STANDS (a draft sent back for
revision files none). Names, enums and counts — never the code.

The fold reads `label: 'unmatched'` as the reason `script-unmatched` (a
script shown in the answer matches no submission of this turn on the
record), and every row as the `script-match` check having reached a
verdict. A matched block fires nothing and supports nothing.

## Properties

### block

> `readonly` **block**: `number`

Defined in: [src/core/agent/assessment/witness.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L127)

1-based position among the answer's fenced blocks that were read.

***

### dispatch?

> `readonly` `optional` **dispatch?**: `number`

Defined in: [src/core/agent/assessment/witness.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L136)

On a match: the call's dispatch within the turn (`ScriptRow.dispatch`) — its identity.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/core/agent/assessment/witness.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L138)

On a match: exactly the runner's exit code, when it supplied one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/assessment/witness.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L125)

The iteration whose answer the match read.

***

### kind

> `readonly` **kind**: `"script-shown"`

Defined in: [src/core/agent/assessment/witness.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L121)

***

### label

> `readonly` **label**: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel) \| `"unmatched"`

Defined in: [src/core/agent/assessment/witness.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L129)

The matched call's label, or `'unmatched'`.

***

### reason?

> `readonly` `optional` **reason?**: [`UnmatchedReason`](/docs/api/type-aliases/UnmatchedReason)

Defined in: [src/core/agent/assessment/witness.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L131)

On `'unmatched'`: why.

***

### tool?

> `readonly` `optional` **tool?**: `string`

Defined in: [src/core/agent/assessment/witness.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L134)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/assessment/witness.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L133)

On a match: the call it equals, and the name the model called.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/assessment/witness.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L123)

`AgentState.turnNumber` when the row was filed — the conversation turn.
