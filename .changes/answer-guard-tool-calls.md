---
type: added
---
**An output guard can see which tools ran.** `.answerValidation()`'s check now
receives `context.toolCalls`: this run's tool calls in landing order, each with
its `name`, `callId` and `outcome` (`'ok'`, `'error'` or `'not-run'`). Arguments
and results are never in it. The list is frozen, read from the run's own state
(never another run's, even under concurrency), bounded by the new
`limits.maxToolCalls` (default 256), and says `complete: false` when calls may be
missing. So a rule like "the answer presents code, but no code-execution tool
ran" can hold the reply in `mode: 'enforce'` and fail the run. Over
`streamHandler` + `agUi()` such a refusal sends no `TEXT_MESSAGE_CONTENT` and
ends in `RUN_ERROR`. Agents without `answerValidation` record exactly what they
did before; agents with it commit one more state key, `toolCallLedger`.
`AnswerToolCall`, `AnswerToolCallsView` and `AnswerValidationContext` are now
exported from the main barrel. Example: `examples/features/99-guard-presented-code.ts`.
