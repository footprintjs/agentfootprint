---
title: CodeRunFacts
---

# Interface: CodeRunFacts

Defined in: [src/core/codeRunnerTool.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L163)

What one finished code run is worth reporting, minus the code itself.

## Properties

### language

> `readonly` **language**: `string`

Defined in: [src/core/codeRunnerTool.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L165)

***

### ok?

> `readonly` `optional` **ok?**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L171)

The runner's reported outcome (`CodeResult.ok`). ABSENT when the runner
 reported none — unknown, never recorded as success.

***

### outputChars

> `readonly` **outputChars**: `number`

Defined in: [src/core/codeRunnerTool.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L167)

***

### shapeHash

> `readonly` **shapeHash**: `string`

Defined in: [src/core/codeRunnerTool.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L172)

***

### stagedInputs

> `readonly` **stagedInputs**: `number`

Defined in: [src/core/codeRunnerTool.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L166)

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/codeRunnerTool.ts:164](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L164)

***

### truncated

> `readonly` **truncated**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L168)
