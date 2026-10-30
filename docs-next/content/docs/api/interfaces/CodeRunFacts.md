---
title: CodeRunFacts
---

# Interface: CodeRunFacts

Defined in: [src/core/codeRunnerTool.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L188)

What one finished code run is worth reporting, minus the code itself.

## Properties

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/core/codeRunnerTool.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L199)

The program's exit status — exactly when the runner supplied one.

***

### language

> `readonly` **language**: `string`

Defined in: [src/core/codeRunnerTool.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L190)

***

### ok?

> `readonly` `optional` **ok?**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L197)

What the runner REPORTED (`CodeResult.ok`). ABSENT when it reported
 nothing — unknown, never recorded as success. A `false` is told apart by
 the three fields below.

***

### outputChars

> `readonly` **outputChars**: `number`

Defined in: [src/core/codeRunnerTool.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L192)

***

### serviceError?

> `readonly` `optional` **serviceError?**: `true`

Defined in: [src/core/codeRunnerTool.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L202)

`true`: the runner flagged an error with no exit status, so whether the
 code ran is not confirmed — not a failed program.

***

### shapeHash

> `readonly` **shapeHash**: `string`

Defined in: [src/core/codeRunnerTool.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L206)

***

### stagedInputs

> `readonly` **stagedInputs**: `number`

Defined in: [src/core/codeRunnerTool.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L191)

***

### terminatedBy?

> `readonly` `optional` **terminatedBy?**: `string`

Defined in: [src/core/codeRunnerTool.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L205)

The signal that ended the process before it exited, when the runner
 knows it (`'SIGKILL'`): no exit status exists, and none is recorded.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/codeRunnerTool.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L189)

***

### truncated

> `readonly` **truncated**: `boolean`

Defined in: [src/core/codeRunnerTool.ts:193](https://github.com/footprintjs/agentfootprint/blob/main/src/core/codeRunnerTool.ts#L193)
