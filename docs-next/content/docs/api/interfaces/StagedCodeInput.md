---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/adapters/types.ts:1164](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1164)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/adapters/types.ts:1172](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1172)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1166](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1166)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/adapters/types.ts:1170](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1170)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
