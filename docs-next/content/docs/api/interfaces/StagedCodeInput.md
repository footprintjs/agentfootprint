---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1146](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1146)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1154](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1154)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1148](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1148)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1152](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1152)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
