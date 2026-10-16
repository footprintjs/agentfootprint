---
type: security
---
**An aborted or timed-out run now cancels the model call in flight, and a late answer is never billed.** Before this, aborting a run (or hitting its `timeoutMs`) stopped the flowchart but left the provider's HTTP request running, and billing. The agent never put the run's signal on the request, a run's `timeoutMs` never reached the stages, and several adapters (Anthropic, OpenAI and every OpenAI-compatible route, Azure OpenAI, Foundry, Bedrock) never passed a signal to their SDK.

Now one rule, in `lib/abort.ts`, covers every provider call. The run's signal, its deadline and the caller's own signal are combined into one signal and placed on every request: from the agent, `LLMCall`, the summarizers, the memory extractors, the constrained pick and the parallel merge. Every adapter hands that signal to the SDK (`{ signal }`, Bedrock's `{ abortSignal }`, Gemini's `config.abortSignal`) or to `fetch`. Each adapter also enforces it itself:

- nothing is sent once the signal has fired;
- every wait is raced against the signal, so a transport that ignores it cannot hold the call open;
- a stream is closed on abort (the SDK's own close, or the fetch body is cancelled);
- an answer that arrives after the abort is refused and is never recorded, counted in usage or reported in `llm_end`.

The abort reaches the caller as the reason they gave, never wrapped as a provider error. `withRetry`, `withFallback` and `withCircuitBreaker` never retry it, fall back from it or count it as a failure, whatever the error is called.

`timeoutMs` now applies even when a `signal` is passed with it (the engine used to ignore it in that case). A run that times out still fails with `Execution timed out after <n>ms`. The deadline is released when the run settles, so it never fires on a run that already finished. `resume(checkpoint, input, { timeoutMs })` now enforces its deadline too; the engine ignored `timeoutMs` on resume. When a run is given both a `signal` and a different `env.signal`, or a deadline, either one now stops the traversal as well as the stages.

`buildAgentMessageApiChart` and `buildMessageApiChart` run on your own `FlowChartExecutor`, which hands its `signal` and `timeoutMs` to the traversal only. Pass the signal in `env` as well (`env: { signal }`) so an abort cancels the model call in flight.

The TypeSafe classifier follows the same rule: a classification that lands after the abort is refused.

A shared conformance test (`test/adapters/conformance/`) runs every adapter factory and class form against a mocked SDK or `fetch` that ignores its signal. The listing check fails closed: a new export or file in `src/adapters/llm/` fails until it has a rig there or is named as no adapter.
