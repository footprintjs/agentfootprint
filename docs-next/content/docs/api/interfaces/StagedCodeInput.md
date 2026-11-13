---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1173](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1173)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1181](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1181)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1175](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1175)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1179](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1179)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
