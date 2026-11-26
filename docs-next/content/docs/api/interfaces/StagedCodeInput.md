---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types/code.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L168)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types/code.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L176)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types/code.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L170)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types/code.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L174)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
