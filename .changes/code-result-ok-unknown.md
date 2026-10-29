---
type: breaking
---
**`CodeResult.ok` can be absent: an outcome the code runner did not report is unknown, never success.** `agentCoreCodeRunner` set `ok: true` when AgentCore reported neither an exit status nor an error flag. The model then read a clean run, and the run record kept `ok: true`. Now `ok` is `true` or `false` only when the backend said which: an exit status, or its own `isError` verdict, including an explicit `isError: false`. Otherwise `ok` is absent. `codeRunnerTool` states the unknown in the result the model reads (`[exit status unknown: …]`) instead of passing it off as either verdict, and `CodeRunFacts.ok` and the `agentfootprint.tools.code_run` event's `ok` are absent in that case too (they read `true`).

A `false` now says which kind it is. `CodeResult.reason` (a `CodeRunReason`) is `'service-error'` when the backend flagged an error and reported no exit status: whether the code ran is not confirmed, which is not a program that failed. `agentCoreCodeRunner` sets it for an `isError` answer with no exit code. Until now that answer and a real exit 7 both reached the record as a bare `ok: false`. `codeRunnerTool` renders it as `[not confirmed: …]` instead of `[exit non-zero]`. The record (`CodeRunFacts`, `agentfootprint.tools.code_run`) now carries `exitCode` exactly when the runner supplied one, and `reason`, beside `ok`.

What breaks for code that reads or builds these shapes:

- `CodeResult.ok` is `ok?: boolean`; `const done: boolean = result.ok` no longer compiles.
- `CodeRunFacts.ok` and `ToolsCodeRunPayload.ok` (`agentfootprint.tools.code_run`) are optional, and both gain `exitCode?: number` and `reason?: 'service-error'`.
- `agentCoreCodeRunner` reports an `isError` answer with no exit code as `{ ok: false, reason: 'service-error' }`, and `codeRunnerTool` renders it as `[not confirmed: …]`, not `[exit non-zero] …`.
- An `agentCoreCodeRunner` `_client` whose answer has neither `exitCode` nor `isError` now produces a result with no `ok`.
- `AgentCoreCodeClientLike.invoke` takes an `AgentCoreInvokeInput` (one arm per service tool: `executeCode`, `writeFiles`, `readFiles`, `executeCommand`) and an optional `{ abortSignal }`; `AgentCoreInvokeAnswer.isError` keeps a reported `false` instead of dropping it.

Migration: read `ok === undefined` as "not reported", neither success nor failure. Read `reason === 'service-error'` as "the run is unconfirmed", not as a failed program. Write `result.ok === true` where you mean "it worked" (`!result.ok` now also catches the unknown case), and read `exitCode` when you need the status itself. A custom `CodeRunner` that knows its outcome keeps setting `ok`; one that does not should leave it out rather than guess.
