---
title: CodeRunFacts
---

# Interface: CodeRunFacts

Defined in: [src/core/codeRunnerTool.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L163)

What one finished code run is worth reporting, minus the code itself.

## Properties

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/core/codeRunnerTool.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L174)

The program's exit status — exactly when the runner supplied one.

***

### language

> `readonly` **language**: `string`

Defined in: [src/core/codeRunnerTool.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L165)

***

### ok?

> `readonly` `optional` **ok?**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L172)

What the runner REPORTED (`CodeResult.ok`). ABSENT when it reported
 nothing — unknown, never recorded as success. A `false` is told apart by
 the three fields below.

***

### outputChars

> `readonly` **outputChars**: `number`

Defined in: [src/core/codeRunnerTool.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L167)

***

### serviceError?

> `readonly` `optional` **serviceError?**: `true`

Defined in: [src/core/codeRunnerTool.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L177)

`true`: the runner flagged an error with no exit status, so whether the
 code ran is not confirmed — not a failed program.

***

### shapeHash

> `readonly` **shapeHash**: `string`

Defined in: [src/core/codeRunnerTool.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L181)

***

### stagedInputs

> `readonly` **stagedInputs**: `number`

Defined in: [src/core/codeRunnerTool.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L166)

***

### terminatedBy?

> `readonly` `optional` **terminatedBy?**: `string`

Defined in: [src/core/codeRunnerTool.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L180)

The signal that ended the process before it exited, when the runner
 knows it (`'SIGKILL'`): no exit status exists, and none is recorded.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/codeRunnerTool.ts:164](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L164)

***

### truncated

> `readonly` **truncated**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L168)
