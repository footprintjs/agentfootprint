---
type: breaking
---
**`CodeResult.ok` is optional: an outcome the code runner did not report is unknown, never success.** `agentCoreCodeRunner` used to fill in `ok: true` when AgentCore reported neither an exit status nor an error flag. The model then read a clean run, and the run record kept `ok: true`. Now `ok` is set only when the backend reported which it was: an exit status, or its own `isError` verdict, including an explicit `isError: false`. Otherwise `ok` is absent, and `codeRunnerTool` tells the model the outcome is unknown (`[exit status unknown: …]`).

Three new optional fields say which kind of `false` a result is. They are on `CodeResult`, on `CodeRunFacts` and on the `agentfootprint.tools.code_run` event:

- `exitCode`: the program ran and exited with this status. It is there only when the runner supplied one, never inferred.
- `serviceError: true`: the backend flagged an error and reported no exit status, so the run is unconfirmed, not failed. `agentCoreCodeRunner` sets it for an `isError` answer with no exit code.
- `terminatedBy`: the signal that ended the process before it exited (`'SIGKILL'`). There is no exit status then.

`codeRunnerTool` writes `[exit N]` only when N was supplied, and `[exit non-zero]` is gone. A failure with no exit status reads `[not confirmed: …]` or `[no exit status reported (terminated by SIGKILL): …]`.

Migration:

1. `CodeResult.ok` is now `ok?: boolean`, and so are `CodeRunFacts.ok` and `ToolsCodeRunPayload.ok`. `const done: boolean = result.ok` no longer compiles.
2. Treat `ok === undefined` as unknown, never as success. Write `result.ok === true` where you mean "it worked". `!result.ok` is now also true for a result whose outcome is unknown.
3. To learn what happened, read `exitCode` for the status, `serviceError` for a run the backend could not confirm, and `terminatedBy` for a process stopped before it exited.
4. Update custom `CodeSession` and `CodeRunner` implementations. Set `ok` only when your backend reported an outcome; otherwise leave it out, and never guess `true`. Set `exitCode` exactly when the backend reports one, `serviceError: true` for an error flag with no exit status, and `terminatedBy` for a stopping signal.
5. A test double for `agentCoreCodeRunner`'s `_client` must now accept `invoke(input, { abortSignal })`. `input` is one of `executeCode`, `writeFiles`, `readFiles` or `executeCommand`. Its answer keeps a reported `isError: false`, and an answer with neither `exitCode` nor `isError` now gives a result with no `ok`.
