**Walker** — the existing native pause resume doors.

# Tool-call resume

The parent handler retains consent admission, durability, clock and findings ordering, then selects exactly one existing door. Each door keeps its original result/history/judge/script/event/settlement and carrier-clearing order. Ephemeral frames are ordinary invocation arguments and never enter AgentState or a checkpoint. An unanswered plain pause still refuses before clearing its carrier.

These functions use the existing tool resolver, invocation and native pause handler. They introduce no dispatcher, scheduler, run registry or additional execution engine. No broad shared finisher replaces the different door contracts.

## The plain door marks a person's typed answer

`plain.ts` · `resumePlain` is the one writer of `LLMMessage.answersAsk`. It stamps `{ requestId }` only when this run's `Agent.resume` accepted the answer to the typed ask this run raised (`ToolCallsHandlerDeps.answeredAsk`) and the value handed to the door is that answer (`tools/typedAnswer.ts` · `isAnswerTo`). Why: any tool can return an `input_received`-shaped result, so every reader of "the person typed this" (`tools/typedAnswer.ts` · `landedTypedAnswer`) counts only a marked message. Every other value this door lands (an `askHuman` reply, a page's frontend-tool result, a string shaped like an answer) lands unmarked, as the tool's result.

```ts
// agent.resume(checkpoint, { requestId, values: { due: '2031-05-05' } }) lands:
{ role: 'tool', toolCallId: 'c1', toolName: 'ask_due', content: '{"status":"input_received",…}', answersAsk: { requestId } }
// agent.resume(checkpoint, '{"status":"input_received",…}') on a pauseHere() pause lands it without answersAsk.
```
