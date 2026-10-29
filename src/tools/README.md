**Mixed** — declaring a tool: its contract, its asks, its argument law, the chain a call walks, and the seam that serves the tool list.
Map: `tools.ts` (the `Tool` contract and `defineTool`), `declare.ts` (what an author declares about each argument, and its one assert), `inputRequest.ts` (the typed ask's fields and the one validator of an answer), `askComponent.ts` (the typed-HITL component grammar), `toolContract.ts` (the agent ↔ tool-server contract check), `toolProvider.ts` (the `ToolProvider` seam).
Walker: `runChain.ts` (the one place a middleware chain is walked), `toolArgsValidation.ts` (arguments against the declared schema, before dispatch), `toolSessions.ts` (the end-signal a tool can be handed, and the tier that fires it).
Fold: none of its own — the one spelling per value it reads (`../lib/normalize.ts`) is a leaf, shared by the evidence gate and the inputs layer.
Lens: `skillScopedTools.ts` (a tool subset while one skill is the most recently loaded — `list(ctx)` is what the model is offered).

# `src/tools/` — what a tool is, before any agent runs it

## Why this folder exists

The agent (`core/`), the injection engine (`injection-engine/`), the MCP
client and server (`mcp/`), the trace toolpack, the code-runner adapter and
the standing host all need the same few facts: what a `Tool` is, how its
arguments are declared and judged, how a typed ask is shaped, and how a
middleware chain is walked. When those facts lived inside `core/`, every one of
those readers imported the agent to reach them, and the injection engine — which
the agent itself mounts — imported it back.

This folder is layer L7 of `scripts/layering.config.cjs`: above the trace
channel and its rules (L5–L6), below the injection engine (L8) and the agent
(L9). It imports nothing above itself at run time. Two type-only imports point
up into `core/` and are erased by `tsc`: `tools.ts` reads `CheckInDemand`
(`core/checkin.ts`) and `runChain.ts` reads the middleware shapes
(`core/agent/middleware/types.ts`).

## Files

- `tools.ts` — `Tool`, `ToolExecutionContext`, `defineTool` and the definition-time asserts.
- `declare.ts` — `askOrAssume` and `period` rules: `assertAskOrAssume`, `rulesOf`, `isMissing`.
- `hostFilled.ts` — arguments the HOST fills from `ctx.credential` / `ctx.identity`: removed from the model's schema, a model-sent value refused by name, the credential scrubbed from what comes back. A decorator over `execute`, so every dispatch door gets it without knowing.
- `toolArgsValidation.ts` — `validateToolArgs`, `validatePropertyValue`.
- `inputRequest.ts` — the typed ask: `requestInput`'s fields, `applyInputResponse`.
- `askComponent.ts` — `AskComponent` and its one assert.
- `toolSessions.ts` — `onTeardown` registration and the firing matrix.
- `requestEvidence.ts` — the internal per-dispatch port a call's MCP retry series files its request attempts through, and the allow-list every filing passes (`agentfootprint.tools.request_attempts`). Not a public retry API.
- `toolContract.ts` — `toolContractCheckup`, a pure diff against a server's catalog.
- `runChain.ts` — `runToolChain`, `runToolAfterChain`, `runMessageChain`.
- `toolProvider.ts` — `ToolProvider`, `ToolDispatchContext`, `ToolGatePredicate`.
- `skillScopedTools.ts` — the provider the agent builder recognises by its id prefix.

Public names reach consumers through the doors, unchanged: `defineTool` and the
tool types from the root `agentfootprint`, `skillScopedTools` and the
`ToolProvider` types from `agentfootprint/providers`.
