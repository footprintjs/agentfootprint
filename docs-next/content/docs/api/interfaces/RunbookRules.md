---
title: RunbookRules
---

# Interface: RunbookRules

Defined in: [src/core/runbook/types.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L48)

Rule provenance — threaded bridge → envelope → coverage sentence, so an
 answer produced under one reading of the rules can be told apart from an
 answer produced under the next.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/runbook/types.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L50)

The rule set's name ('health-signal'). Non-empty.

***

### version

> `readonly` **version**: `string`

Defined in: [src/core/runbook/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L53)

Its version stamp ('v1'). Non-empty; bump when the READING changes,
 never for wording.
