---
title: CheckInDecision
---

# Interface: CheckInDecision

Defined in: [src/core/checkin.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L172)

## Properties

### approved

> `readonly` **approved**: `boolean`

Defined in: [src/core/checkin.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L174)

True to run the tool, false to decline it.

***

### at

> `readonly` **at**: `number`

Defined in: [src/core/checkin.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L180)

When the decision was made (ms since epoch).

***

### by

> `readonly` **by**: `string`

Defined in: [src/core/checkin.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L176)

Who decided (an operator id, an email, a queue name — your call).

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/core/checkin.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L178)

Optional note. On decline it is surfaced to the model so it can adapt.

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/docs/api/interfaces/DecisionValue)

Defined in: [src/core/checkin.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L187)

What they chose, when the answer was a value and not just a yes.

Optional everywhere: a decision without one is byte-identical to every
earlier release, and a screen that only approves or declines never sets it.
