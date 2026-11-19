---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1133](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1133)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1141](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1141)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1135](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1135)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1139](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1139)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
