---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/adapters/types.ts:941](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L941)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/adapters/types.ts:949](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L949)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:943](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L943)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/adapters/types.ts:947](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L947)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
