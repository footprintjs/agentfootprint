**Fold** — one comparison per model request, on a model that binds its reasoning to its context.

# `core/agent/contextBinding/` — the named refusal for a changed tool turn

Some Claude models (preserved thinking) accept a signed thinking block only under the system
prompt, tool list and earlier messages it was written under. The provider answers per model
(`LLMProvider.thinkingBinding`, read by `provider-contract/thinkingBinding.ts` · `thinkingBindingOf`):
`bound`, `unbound`, or `unknown` for an id its table cannot place, and who said so (`provider`, or
`app` through the Anthropic adapters' `thinkingBinding` option). On a `bound` or `unknown` model,
the call stage asks this folder one question before each request: what does this request change
under the newest signed reasoning in its history?

| File | Job |
|---|---|
| `composition.ts` | A request as fingerprints: system prompt pieces (source, id, hash), tools by name (hash, the party that put each forward), messages one hash each. Thinking and replay metadata are not part of a message's hash. |
| `compare.ts` | The named differences between a baseline and a request. Pure. |
| `check.ts` | The rule and its three outcomes, and the baseline a signed response leaves. |
| `forCall.ts` | The call stage's one door: asked only when the binding is `bound` or `unknown` (the stricter answer across a reliability chain). |

## The rule

- **Refused**: the model is `bound`, the newest signed reasoning is on the wire, belongs to an
  unfinished tool turn, and anything differs from the request it was written under. `ContextChangedError` (from
  `thinking/contextChange.ts`) is thrown by `stages/callLLM.ts` after the receipt is written and
  before the provider is called, so the adapter's own guard (`UnsafeThinkingReplayError`) is never
  the first thing a caller reads. It is a request refusal (`provider-contract/requestRefusal.ts`):
  not retried, not a fallback reason, not a circuit failure.
- **Recorded**: any other difference — the reasoning's turn has ended (the adapter retires that
  reasoning and reports it), the wire left the signed turn out (the wrap-up does), or the model's
  binding is `unknown`. An unknown id may serve an older model whose thinking is not bound, and
  such a run works today, so it is sent and the provider decides; the row says `binding: 'unknown'`. The record is
  `contextChange` on `agentfootprint.stream.llm_start`: that event is the claim of what this call
  carried, and it already fires once per request, so no new event type is needed.
- **Unchecked**: the newest signed reasoning came from a response this run did not record (a
  continued or restored conversation). Nothing is compared or refused; the adapter's guard and the
  API decide.

Nothing is recorded when nothing changed, when no signed reasoning is in the history, or on an
unbound model: those runs keep their exact prior bytes. Every row carries `binding` and `by`.

## What is kept, and where

One baseline per run, in the run's private values (`runValues.ts` · `contextBaseline`): the request
behind the newest signed response. It is not chart state and not checkpointed, so a resumed or
continued run starts `unchecked`. Persisting the first-sent request with the conversation is a later
step with its own checkpoint-shape decision.

## Known limits

- The comparison reads the request as the agent assembled it, before a host's own cache strategy
  runs. A strategy that rewrites messages differently on a later request is still caught by the
  adapter's guard, with its generic error.
- A message dropped from the front shifts every later position: it is named as the first position
  that differs, not as a removal.
- An opaque or unknown model id is `unknown` until the app states it, so a changed tool turn there
  is recorded, not refused; if the model behind it does bind, the provider's own error stands.
