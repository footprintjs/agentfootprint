---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1141](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1141)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1149](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1149)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1143](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1143)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1147](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1147)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
