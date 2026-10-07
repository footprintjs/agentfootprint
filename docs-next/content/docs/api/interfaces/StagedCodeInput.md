---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/adapters/types.ts:1158](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1158)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/adapters/types.ts:1166](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1166)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1160](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1160)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/adapters/types.ts:1164](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1164)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
