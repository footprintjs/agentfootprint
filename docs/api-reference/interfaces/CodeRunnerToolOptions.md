[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeRunnerToolOptions

# Interface: CodeRunnerToolOptions

Defined in: [src/core/codeRunnerTool.ts:65](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L65)

## Properties

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/agentfootprint/api/generated/type-aliases/CheckInDemand.md)\<\{ `code`: `string`; \}\>

Defined in: [src/core/codeRunnerTool.ts:95](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L95)

Demand a human check-in before code runs — `'always'`, or a predicate over
 the code string. A pause here does NOT tear the session down.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/core/codeRunnerTool.ts:73](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L73)

Description the model sees. A sensible one is composed from `scope` +
 `language` when you do not pass one.

***

### language?

> `readonly` `optional` **language?**: `string`

Defined in: [src/core/codeRunnerTool.ts:87](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L87)

Default language for the code the model writes. Default `'python'`.

***

### maxOutputChars?

> `readonly` `optional` **maxOutputChars?**: `number`

Defined in: [src/core/codeRunnerTool.ts:90](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L90)

Per-stream ceiling for what reaches the model, in characters. Default 4000.
 Anything cut is STATED in the result, never dropped quietly.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/codeRunnerTool.ts:70](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L70)

Tool name the model sees. Default `'run_code'`.

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/codeRunnerTool.ts:98](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L98)

A credential this tool needs (declare-and-push). Resolved before execute.
 Do NOT cache it past the call: a session outliving a run outlives its token.

***

### runner

> `readonly` **runner**: [`CodeRunner`](/agentfootprint/api/generated/interfaces/CodeRunner.md)

Defined in: [src/core/codeRunnerTool.ts:68](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L68)

The backend. `localCodeRunner()` for a dev loop, `agentCoreCodeRunner(...)`
 for a real sandbox — the tool is identical across the swap.

***

### scope?

> `readonly` `optional` **scope?**: [`CodeRunnerToolScope`](/agentfootprint/api/generated/type-aliases/CodeRunnerToolScope.md)

Defined in: [src/core/codeRunnerTool.ts:85](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L85)

How long one session lives. Default `'run'` — a turn's worth of work shares
one interpreter, and nothing outlives the turn.

`'session'` keeps the interpreter across the turns of one hosted
conversation (variables persist, files persist) and REQUIRES a
session-bound run plus a composition root that calls
`agent.closeToolSessions({ sessionId })`.

`'call'` starts and stops per invocation — the safest and the slowest.

***

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Defined in: [src/core/codeRunnerTool.ts:92](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L92)

Per-execution ceiling handed to the runner.
