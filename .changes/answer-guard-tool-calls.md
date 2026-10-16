---
type: added
---
**An output guard can see which tools ran.** `.answerValidation()`'s check now
receives `context.toolCalls`: this run's tool calls in landing order, each with
its `name`, `callId` and `outcome` (`'ok'`, `'error'` or `'not-run'`). Arguments
and results are never in it. The list is frozen, read from the run's own state
(never another run's, even under concurrency) at the moment of the check,
bounded by the new `limits.maxToolCalls` (default 256), and says
`complete: false` when it may disagree with what the run did (a call still open
or `pending`, a cut-off reply's calls, a `resumeOnError` leg, …). It fails
closed: a check that reads an incomplete list gets an `unverified` report,
whatever it returns. So a rule like "the answer presents code, but no code-execution tool
ran" can hold the reply in `mode: 'enforce'` and fail the run. Over
`streamHandler` + `agUi()` such a refusal sends no `TEXT_MESSAGE_CONTENT` and
ends in `RUN_ERROR`. Agents without `answerValidation` record exactly what they
did before; agents with it commit one more state key, `toolCallLedger`.
`AnswerToolCall`, `AnswerToolCallsView` and `AnswerValidationContext` are now
exported from the main barrel. Example: `examples/features/99-guard-presented-code.ts`.
