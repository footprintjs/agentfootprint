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
- `codeSandbox.ts` — the code-session port's refusals (`CodeSandboxError`, one
  `reason` per refusal) and its ONE path rule, `sandboxPath`: a session path is
  relative to the working directory and never above it. Both code adapters call
  it before they read, so a path one refuses the other refuses too — two copies
  of a path rule would be two rules. Example: `sandboxPath('./out//a.csv')` is
  `'out/a.csv'`; `sandboxPath('../secret')` throws `reason: 'path-refused'`.
- `sessionExpired.ts` — `SessionExpiredError`: a remote session that is gone,
  said one way whatever words the service used, so "start a new session" is one
  `instanceof` away. Nothing reconnects — a session name is not an address.

## The one law here

A port is OUR shape; an adapter (`../adapters/`) is THEIR shape. This folder
holds only the port and the facts read off it, so the agent, the provider
decorators (`resilience/`), `security/`, `memory/`, `cache/` and `thinking/`
read it without importing any implementation. It imports only the
vocabularies below it (`events/`, `thinking/`, `cache/`); `adapters/`
implements it and nothing below `adapters/` imports `adapters/`
(`npm run check:layering`).

Automatic native output additionally requires `LLMProvider.supportsAutoNativeOutputSchema(model)` to return true. This positive knowledge declaration is separate from the existing forward-compatible `supportsNativeOutputSchema` contract: an unknown model or a missing auto declaration stays on instructions. Retry/circuit wrappers forward it; fallback pairs intersect it.
