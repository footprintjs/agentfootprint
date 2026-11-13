---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/provider-contract/types.ts:1166](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1166)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/provider-contract/types.ts:1174](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1174)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:1168](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1168)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/provider-contract/types.ts:1172](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1172)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
