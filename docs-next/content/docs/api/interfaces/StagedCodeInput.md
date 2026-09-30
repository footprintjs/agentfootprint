---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/adapters/types.ts:1151](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1151)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/adapters/types.ts:1159](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1159)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1153](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1153)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/adapters/types.ts:1157](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1157)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
