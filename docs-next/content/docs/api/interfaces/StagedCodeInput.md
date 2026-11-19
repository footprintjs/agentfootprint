---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1147](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1147)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1155](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1155)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1149](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1149)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1153](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1153)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
