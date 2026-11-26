---
type: changed
bump: minor
---
**Skills work inside a signed thinking turn on the newest Claude models: every skill tool is listed from the first request, and a loaded body is the `read_skill` result.**
On a model whose thinking is bound to the context it was written under (`thinkingBinding` answers `bound`, or `unknown` for an id the adapter cannot place: Claude Haiku, Sonnet and Opus 5.5, Fable 5.1 and 5.2, Mythos 5.2, an application inference profile), a skill loaded in the middle of a tool turn was refused with `ContextChangedError`, because its body joined the system prompt and its scoped tools joined the tool list. The new `AgentOptions.skillContext` defaults to `'listed'` on such a model, so a skill load changes neither:

- every skill tool, scoped ones included, is on the tool list from the first request with a description that does not change, and `read_skill`'s description is the catalog for the whole run (it no longer follows the graph cursor or the turn's menu);
- the body of a skill `read_skill` loads is that call's result, never the system prompt, and it is exempt from `maxToolResultChars` and artifact placement;
- **behaviour change:** a call to a scoped skill's tool before its skill is loaded is now refused with a fixed sentence naming the skill and the next step, and the tool does not run. Before, such a call ran without being offered.

The choice is recorded as `skillContext` on the first `agentfootprint.stream.llm_start` of each run: the tool strategy and the body channel in the shared decision-record shape (`strategy`, `by`, `rule`, `label`, `reads`, `voucher`), and the binding answer that decided them. Every other model (OpenAI-family, Gemini, Ollama, mock, older Claude) keeps `'declared'` and its exact request and event bytes. Still refused by name inside a signed tool turn: a skill the graph activates when its cursor moves, step narrowing, an `activeWhen` instruction, a moving tool provider.

Migration: to keep each skill's own `autoActivate` and `surfaceMode` on a bound model, pass `Agent.create({ ..., skillContext: 'declared' })`; a skill load inside a signed tool turn is then refused by name as before.
