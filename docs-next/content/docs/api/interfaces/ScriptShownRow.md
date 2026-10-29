---
title: ScriptShownRow
---

# Interface: ScriptShownRow

Defined in: [src/core/agent/assessment/witness.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L126)

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

Defined in: [src/core/agent/assessment/witness.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L133)

1-based position among the answer's fenced blocks that were read.

***

### dispatch?

> `readonly` `optional` **dispatch?**: `number`

Defined in: [src/core/agent/assessment/witness.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L142)

On a match: the call's dispatch within the turn (`ScriptRow.dispatch`) — its identity.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/core/agent/assessment/witness.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L144)

On a match: exactly the runner's exit code, when it supplied one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/assessment/witness.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L131)

The iteration whose answer the match read.

***

### kind

> `readonly` **kind**: `"script-shown"`

Defined in: [src/core/agent/assessment/witness.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L127)

***

### label

> `readonly` **label**: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel) \| `"unmatched"`

Defined in: [src/core/agent/assessment/witness.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L135)

The matched call's label, or `'unmatched'`.

***

### reason?

> `readonly` `optional` **reason?**: [`UnmatchedReason`](/docs/api/type-aliases/UnmatchedReason)

Defined in: [src/core/agent/assessment/witness.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L137)

On `'unmatched'`: why.

***

### tool?

> `readonly` `optional` **tool?**: `string`

Defined in: [src/core/agent/assessment/witness.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L140)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/assessment/witness.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L139)

On a match: the call it equals, and the name the model called.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/assessment/witness.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/assessment/witness.ts#L129)

`AgentState.turnNumber` when the row was filed — the conversation turn.
