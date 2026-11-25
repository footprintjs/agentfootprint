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
| `composition.ts` | A request as fingerprints: system prompt pieces (source, id, hash), tools by name (hash, the party that put each forward), messages one hash each over the fields the wire carries (role, content, tool call ids, names and arguments) — exactly what the adapter's guard compares. Thinking blocks and replay metadata are not hashed, so the library's own retirement of finished-turn thinking is not an edit. |
| `compare.ts` | The named differences between a baseline and a request. Pure. |
| `check.ts` | The rule and its three outcomes, and the baseline a signed response leaves. |
| `forCall.ts` | The call stage's one door: asked only when the provider and model THIS call goes to answer `bound` or `unknown`. Never a blend with a reliability chain's later providers, whose own adapters check the calls they serve. |

## The rule

- **Refused**: the model is `bound`, the newest signed reasoning is on the wire, was written by a
  bound model of the same family (`replay.binding.model`, the adapter's own test), belongs to an
  unfinished tool turn, and anything differs from the request it was written under. A block an
  unbound model wrote, or another family wrote (a model switch, which the API answers by
  dropping the block), is not checked here: no row. `ContextChangedError` (from
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
  API decide. Said once per such response.

Nothing is recorded when nothing changed, when no signed reasoning is in the history, or on an
unbound model: those runs keep their exact prior bytes. Every row carries `binding` and `by`.

## What is kept, and where

One baseline per signed response, keyed by its replay id (the newest 16), in the run's private
values (`runValues.ts` · `contextBaseline`). A newer signed response that is then kept off the
wire (an evidence revision's draft) does not hide the base of the reasoning that is on it. It is not chart state and not checkpointed, so a resumed or
continued run starts `unchecked`. Persisting the first-sent request with the conversation is a later
step with its own checkpoint-shape decision.

## Known limits

- The refusal is thrown before the cache strategy prepares the request, so a host strategy's I/O
  never runs for a refused request; that also means no receipt is minted for it.
- The comparison reads the request as the agent assembled it, before a host's own cache strategy
  runs. A strategy that rewrites messages differently on a later request is still caught by the
  adapter's guard, with its generic error.
- A message dropped from the front shifts every later position: it is named as the first position
  that differs, not as a removal.
- An opaque or unknown model id is `unknown` until the app states it, so a changed tool turn there
  is recorded, not refused; if the model behind it does bind, the provider's own error stands.
- Names on the record are cut at 128 characters with control characters removed; the refusal's
  sentence quotes at most 64 characters of each, with markup characters replaced. Skill ids come
  from the app and MCP tool names from servers: both are untrusted text.
