---
title: ScriptsVerdict
---

# Interface: ScriptsVerdict

Defined in: [src/lib/scriptRecord.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L77)

What the match says about one judged answer — on the verdict and `evidence_checked`.

## Properties

### blocks

> `readonly` **blocks**: readonly [`ScriptBlockVerdict`](/docs/api/type-aliases/ScriptBlockVerdict)[]

Defined in: [src/lib/scriptRecord.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L79)

One entry per fenced block read, in answer order. Never the code.

***

### earlierTurnRows

> `readonly` **earlierTurnRows**: `number`

Defined in: [src/lib/scriptRecord.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L81)

Script rows of EARLIER turns on the ledger — counted, never compared.

***

### regionsDropped

> `readonly` **regionsDropped**: `number`

Defined in: [src/lib/scriptRecord.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L83)

Fenced blocks past `MAX_CODE_REGIONS`: read as prose, never matched.

***

### scriptsDropped?

> `readonly` `optional` **scriptsDropped?**: `number`

Defined in: [src/lib/scriptRecord.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L89)

Calls of this turn past `MAX_SCRIPT_ROWS` (`AgentState.scriptsDropped`):
they filed no row, so a block showing one of them cannot match. Absent
when none was dropped.
