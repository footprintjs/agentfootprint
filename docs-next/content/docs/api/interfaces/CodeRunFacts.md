---
title: CodeRunFacts
---

# Interface: CodeRunFacts

Defined in: [src/core/codeRunnerTool.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L169)

What one finished code run is worth reporting, minus the code itself.

## Properties

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/core/codeRunnerTool.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L181)

The program's exit status — exactly when the runner supplied one.

***

### language

> `readonly` **language**: `string`

Defined in: [src/core/codeRunnerTool.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L171)

***

### ok?

> `readonly` `optional` **ok?**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L179)

What the runner REPORTED (`CodeResult.ok`). ABSENT when it reported
 nothing — unknown, never recorded as success. `false` is a failed
 program when `exitCode` is present, and an unconfirmed run when `reason`
 is `'service-error'`.

***

### outputChars

> `readonly` **outputChars**: `number`

Defined in: [src/core/codeRunnerTool.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L173)

***

### reason?

> `readonly` `optional` **reason?**: `"service-error"`

Defined in: [src/core/codeRunnerTool.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L184)

`'service-error'`: the runner flagged an error with no exit status, so
 whether the code ran is not confirmed. Absent otherwise.

***

### shapeHash

> `readonly` **shapeHash**: `string`

Defined in: [src/core/codeRunnerTool.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L185)

***

### stagedInputs

> `readonly` **stagedInputs**: `number`

Defined in: [src/core/codeRunnerTool.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L172)

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/codeRunnerTool.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L170)

***

### truncated

> `readonly` **truncated**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L174)
