---
title: StagedCodeInput
---

# Interface: StagedCodeInput

Defined in: [src/adapters/types.ts:1044](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1044)

Where one staged input actually landed.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/adapters/types.ts:1052](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1052)

How many bytes landed.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:1046](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1046)

The name it was asked for — the manifest key the code looks up.

***

### path

> `readonly` **path**: `string`

Defined in: [src/adapters/types.ts:1050](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1050)

The path the executing code opens. Absolute, or relative to the session's
 working directory: whichever it is, it is what the manifest carries and
 what the code should use verbatim.
