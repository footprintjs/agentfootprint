---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/adapters/types.ts:1142](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1142)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/adapters/types.ts:1150](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1150)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1144](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1144)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/adapters/types.ts:1148](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1148)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
