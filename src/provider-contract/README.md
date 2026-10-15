**Support** — the provider port: the shapes a model provider implements and the
few facts every caller asks of one. It decides nothing about what the model may
see; the agent composes the request, an adapter carries it.

# `provider-contract/` — what a provider implements

## What lives here

- `types.ts` — the ports of the hexagonal architecture, in one place
  (`LLMProvider`, `LLMRequest`, `LLMResponse`, `LLMMessage`, `LLMToolSchema`,
  the memory, permission, pricing and credential ports).
- `forcedToolChoice.ts`, `nativeOutputSchema.ts` — the capability readers
  (`forcedToolChoiceFor`, `nativeOutputSchemaFor`) and the one typed refusal
  each, for a model that does not take a forced tool choice or a native output
  schema.
- `requestRefusal.ts` — the narrow shared classifier for terminal
  request-contract refusals, not transport failures or arbitrary application
  errors.
- `contextWindow.ts` — `ContextWindowExceededError`: the budget refusal, named.

## The one law here

A port is OUR shape; an adapter (`../adapters/`) is THEIR shape. This folder
holds only the port and the facts read off it, so the agent, the provider
decorators (`resilience/`), `security/`, `memory/`, `cache/` and `thinking/`
read it without importing any implementation. It imports only the
vocabularies below it (`events/`, `thinking/`, `cache/`); `adapters/`
implements it and nothing below `adapters/` imports `adapters/`
(`npm run check:layering`).
