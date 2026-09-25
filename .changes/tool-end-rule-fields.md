---
type: added
---
**`stream.tool_end` says what a CONFIGURED RULE did.** Three optional fields, each absent unless a rule acted, so an agent with no rule records exactly the bytes it did before (pinned for the no-rule paths: a call that ran, an unknown tool name, an args rejection under the default validation, a throwing credential provider, a plain `absent()`):

- `modelResult` — what the model read, when an `onToolResult` rule or the cap made it differ from `result`; all five dispatch paths.
- `changedArgKeys` — the NAMES of the keys an `onToolCall` rule changed or the tool's `redact` policy hides. Never values (a rule can add a server-side value the model never saw, and an event reaches every sink), taken before the tool runs.
- `notExecuted` — a permission policy or an `onToolCall` rule refused the call. Its absence proves nothing: a call that could not run with no rule involved says so with `error: true`, a settled bracket with `notDispatched`, and a resumed leg's bracket carries neither.

`changedArgKeys` / `notExecuted` ride the batch dispatch path only. `flowchartAsTool({ redact })` and `runbookAsTool({ redact })` now govern the call's arguments too — a key the policy names is withheld wherever the arguments are shown, as the tool's result always was. `tools.code_run` names the tool the model called (for a `codeRunnerTool` re-exposed under another schema name, its registered name; identical whenever the two agree).
