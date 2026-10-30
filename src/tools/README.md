**Mixed** — declaring a tool: its contract, its asks, its argument law, the chain a call walks, and the seam that serves the tool list.
Map: `tools.ts` (the `Tool` contract and `defineTool`), `declare.ts` (what an author declares about each argument, and its one assert), `script.ts` (a tool's declaration that it runs a program, and its one assert), `inputRequest.ts` (the typed ask's fields and the one validator of an answer), `askComponent.ts` (the typed-HITL component grammar), `toolContract.ts` (the agent ↔ tool-server contract check), `toolProvider.ts` (the `ToolProvider` seam).
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

## The app's words for a call — `displayName`

**The rule.** `defineTool({ displayName })` declares the app's own words for what a
call of the tool does ("loading the attached data"). The standing line names a
reason's calls only by it, and uses it in its assumed clause; the limits block marks
an item's declaring calls with it and names its `Period:` / "In progress" lines by it
(`../core/agent/assessment/README.md`, "What a reason rests on"). Not every surface
uses it yet: the time layer's limits lines (under `.time()`) and the answer account's
rows still print the registered name — a known follow-up. One
plain line of at most 60 characters, stored trimmed, judged by the one rule
(`../lib/displayName.ts` · `displayNameProblem`) at `defineTool` and again at
registration, so a hand-built tool cannot bring a bidi override or a line break to
a person's screen.

**Why.** The registered name is the model's vocabulary, and an app may forbid
showing it. So a reason's calls never fall back to it: a call whose tool declares no
`displayName` is counted ("and 1 other call"), never named, and an agent whose
tools declare none appends the bytes it always did. A remote tool's server cannot
supply one: `mcpClient` never reads it from `_meta`.

```ts
const loadAttachment = defineTool({
  name: 'load_attachment',
  description: 'Load the files attached to this conversation',
  displayName: 'loading the attached data',
  execute: () => absent({ what: 'an attached data file', checked: ['the files attached to this chat'] }),
});
// .answerLayer({ standingLine: true }) → '…\n\n---\n\nNot sure — loading the attached data reported no matching results.'
```

## A tool that runs a program — `script`

**The rule.** `defineTool({ script: { argument, language? } })` declares that the
tool runs a program, carried in one of its arguments. It is declared, never inferred:
the library never reads it off a tool's name, a property called `code` or the
description. The argument must be a declared string property of the input schema, and
not a `wants` argument. `language`, when given, is one plain token of at most 64
characters, with no backtick and no line break, because it becomes the info string of
the fence the library renders.

One assert judges the declaration (`script.ts` · `assertToolScript`) at three doors:
- `defineTool`;
- MCP ingest (`_meta.agentfootprint.script`, which the server side also serves);
- dispatch (`script.ts` · `scriptOf`), for a tool built by hand or served by a
  `ToolProvider`.

At dispatch, a declaration that fails the assert is treated as no declaration, and dev
mode names the rule once. `codeRunnerTool` declares `{ argument: 'code', language }`
itself.

**Why.** An answer may hand back the script that computed it. While
`.namesAndNumbersFromEvidence({ code: 'match' })` or `.scriptTravelsWithTheAnswer()`
is on, each call of a declaring tool records the program it was handed and what its
runner reported. The evidence gate can then tell a script shown as submitted from code
the model wrote, and the library can attach the program itself
(`../core/agent/scripts/README.md`). A tool that runs code without declaring it has no
submissions on the record, so a script the model shows for it stays prose.

```ts
const runSql = defineTool({
  name: 'run_sql',
  description: 'Run a read-only SQL query and print the rows.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  script: { argument: 'query', language: 'sql' },
  execute: async ({ query }) => db.read(query),
});
```

## Files

- `tools.ts` — `Tool`, `ToolExecutionContext`, `defineTool` and the definition-time asserts (`assertDisplayName` among them).
- `declare.ts` — `askOrAssume` and `period` rules: `assertAskOrAssume`, `rulesOf`, `isMissing`.
- `script.ts` — `ToolScript`, the declaration that a tool runs a program: `assertToolScript` (the one rule), `copyToolScript`, `scriptOf` (the dispatch door, judged once per tool).
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
