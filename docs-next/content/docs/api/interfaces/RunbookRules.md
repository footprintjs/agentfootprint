---
title: RunbookRules
---

# Interface: RunbookRules

Defined in: [src/core/runbook/types.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L47)

Rule provenance — threaded bridge → envelope → coverage sentence, so an
 answer produced under one reading of the rules can be told apart from an
 answer produced under the next.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/runbook/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L49)

The rule set's name ('health-signal'). Non-empty.

***

### version

> `readonly` **version**: `string`

Defined in: [src/core/runbook/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L52)

Its version stamp ('v1'). Non-empty; bump when the READING changes,
 never for wording.
