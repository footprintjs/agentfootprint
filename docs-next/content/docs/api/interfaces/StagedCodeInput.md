---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1155](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1155)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1163](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1163)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1157](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1157)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1161](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1161)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
