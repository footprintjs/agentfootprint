---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1118](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1118)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1126](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1126)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1120](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1120)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1124](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1124)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
