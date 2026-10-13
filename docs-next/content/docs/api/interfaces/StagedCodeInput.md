---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/adapters/types.ts:1101](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1101)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/adapters/types.ts:1109](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1109)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1103](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1103)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/adapters/types.ts:1107](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1107)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
