---
title: ScriptsVerdict
---

# Interface: ScriptsVerdict

Defined in: [src/lib/scriptRecord.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L84)

What the match says about one judged answer — on the verdict and `evidence_checked`.

## Properties

### blocks

> `readonly` **blocks**: readonly [`ScriptBlockVerdict`](/docs/api/type-aliases/ScriptBlockVerdict)[]

Defined in: [src/lib/scriptRecord.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L86)

One entry per fenced block read, in answer order. Never the code.

***

### earlierTurnRows

> `readonly` **earlierTurnRows**: `number`

Defined in: [src/lib/scriptRecord.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L88)

Script rows of EARLIER turns on the ledger — counted, never compared.

***

### regionsDropped

> `readonly` **regionsDropped**: `number`

Defined in: [src/lib/scriptRecord.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L90)

Fenced blocks past `MAX_CODE_REGIONS`: read as prose, never matched.

***

### scriptsDropped?

> `readonly` `optional` **scriptsDropped?**: `number`

Defined in: [src/lib/scriptRecord.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L96)

Calls of this turn past `MAX_SCRIPT_ROWS` (`AgentState.scriptsDropped`):
they filed no row, so a block showing one of them cannot match. Absent
when none was dropped.
