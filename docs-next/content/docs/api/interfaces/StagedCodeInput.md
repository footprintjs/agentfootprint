---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1111](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1111)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1119](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1119)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1113](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1113)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1117](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1117)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
