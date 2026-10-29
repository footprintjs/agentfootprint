---
type: breaking
---
**`CodeResult.ok` can be absent: an outcome the code runner did not report is unknown, never success.** `agentCoreCodeRunner` set `ok: true` when AgentCore reported neither an exit status nor an error flag. The model then read a clean run, and the run record kept `ok: true`. Now `ok` is `true` or `false` only when the backend said which: an exit status, or its own `isError` verdict, including an explicit `isError: false`. Otherwise `ok` is absent. `codeRunnerTool` states the unknown in the result the model reads (`[exit status unknown: …]`) instead of passing it off as either verdict, and `CodeRunFacts.ok` and the `agentfootprint.tools.code_run` event's `ok` are absent in that case too (they read `true`).

A `false` now says which kind it is, through three new optional fields:

- `exitCode`: a program that ran and exited with that status.
- `CodeResult.serviceError: true`: the backend flagged an error and reported no exit status. Whether the code ran is not confirmed, which is not a program that failed. `agentCoreCodeRunner` sets it for an `isError` answer with no exit code; until now that answer and a real exit 7 both reached the record as a bare `ok: false`.
- `CodeResult.terminatedBy`: the signal that ended a process before it exited (`'SIGKILL'`), when the runner knows it. There is no exit status then.

`codeRunnerTool` writes `[exit N]` only when N was supplied. It used to write `[exit non-zero]` for any `false` with no number. Now it renders the three as `[exit 7] …`, `[not confirmed: …]` and `[no exit status reported (terminated by SIGKILL): …]`, and it never contradicts a field the runner supplied (`exitCode: 0` with no `ok` adds no line). The record (`CodeRunFacts`, `agentfootprint.tools.code_run`) carries `exitCode`, `serviceError` and `terminatedBy` exactly as the runner supplied them, beside `ok`.

What breaks for code that reads or builds these shapes:

- `CodeResult.ok` is `ok?: boolean`; `const done: boolean = result.ok` no longer compiles.
- `CodeRunFacts.ok` and `ToolsCodeRunPayload.ok` (`agentfootprint.tools.code_run`) are optional, and both gain `exitCode?: number`, `serviceError?: true` and `terminatedBy?: string`.
- `agentCoreCodeRunner` reports an `isError` answer with no exit code as `{ ok: false, serviceError: true }`, and `codeRunnerTool` renders it as `[not confirmed: …]`, not `[exit non-zero] …`.
- `codeRunnerTool` never prints `[exit non-zero]`: a failure with no exit status reads `[no exit status reported …]`.
- An `agentCoreCodeRunner` `_client` whose answer has neither `exitCode` nor `isError` now produces a result with no `ok`.
- `AgentCoreCodeClientLike.invoke` takes an `AgentCoreInvokeInput` (one arm per service tool: `executeCode`, `writeFiles`, `readFiles`, `executeCommand`) and an optional `{ abortSignal }`; `AgentCoreInvokeAnswer.isError` keeps a reported `false` instead of dropping it.

Migration: read `ok === undefined` as "not reported", neither success nor failure. Read `serviceError` as "the run is unconfirmed", not as a failed program, and `terminatedBy` as "ended before it exited". Write `result.ok === true` where you mean "it worked" (`!result.ok` now also catches the unknown case), and read `exitCode` when you need the status itself. A custom `CodeRunner` that knows its outcome keeps setting `ok`; one that does not should leave it out rather than guess.
