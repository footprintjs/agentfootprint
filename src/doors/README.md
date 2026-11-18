**Mixed** — the published doors, each a header plus a re-export, cut by the
JOB a consumer has rather than by role. A door therefore usually publishes more
than one role, and this file says which.
Map + Fold: `skill-graph.ts` (the graph and its folds, with no framework
attached — the one door whose cut is proved by a test that walks its transitive
imports) and `recipes.ts` (declared configuration).
Map + Walker + Lens: `context.ts` re-exports the whole injection-engine barrel,
which carries the declarations, the folds, the per-iteration walk AND the
`read_skill` composers (`readSkillDescriptor`, `buildReadSkillTool`).
Trace + Fold: `observe.ts` (recorders, `recordRun`, ledger, bisect, toolpack).
Fold: `maps.ts` (the mount kernel's vocabulary) and `time.ts` (the time layer's
conversions — `convertForTool` over a tool's own `period`, and its steps — for
an app that needs the library's answer outside a run; a door of its own because they
are the layer's run-time half, which the main barrel keeps off the default
graph; it also carries `timeReplyPairs`, the reader a host's front end uses on
a time ask, so the door stays free of anything from Node).
Map + Lens: `ontology.ts` (the declared map — `defineOntology` and the shapes
are Map; `ontologyPiece` and the always-on ask are Lens).
Lens: `ag-ui.ts` (one run served to an AG-UI reader — `agUiSerializer` builds
the protocol's events from the record's served stream, `agUiSse` frames them).
Support: `memory.ts`, `providers.ts`, `hosting.ts`, `rag.ts`, `security.ts`,
`resilience.ts`, `classify.ts`.

## What it reads / what it writes
Nothing at runtime. Each file is a header stating the door's job plus one or two
`export *` lines.

## The one law here
A door is named for the consumer's question, not for the layer it exposes. When
one door publishes symbols of several roles, the header says so — importing
through a door tells you nothing about whether a symbol may compose a sentence.

## Files
One file per door: `skill-graph.ts`, `context.ts`, `observe.ts`, `maps.ts`,
`recipes.ts`, `memory.ts`, `providers.ts`, `hosting.ts`, `rag.ts`,
`security.ts`, `resilience.ts`, `classify.ts`, `ontology.ts`, `time.ts`,
`ag-ui.ts`.


## Complete public-door contract

Entry points — NINETEEN doors, and `package.json` `exports` is exhaustive, so a path not on this list does not resolve at all: `.` core API · `/providers` everything you plug a backend into (mock/anthropic/openai/bedrock/browser*, embedders, staticTools/gatedTools/skillScopedTools/mcpClient, thinking handlers, code runners) · `/memory` (defineMemory, MEMORY_TYPES, InMemoryStore, mockEmbedder, redis/agentcore/bedrockAgentMemory stores) · `/rag` index-time loaders/splitters/indexCorpus · `/cache` prompt caching (+ cacheStrategyFor — the strategy is chosen from the provider's DECLARED `promptCaching`, never its name; nothing registers at load) · `/observe` the whole watching story (recorders, recordRun, strategies + attach*, vendor sinks, run-autopsy finders, toSSE, status, locales) · `/events` typed event system · `/context` the injection engine (defineInjection/Skill/Fact/Instruction/Steering, decideSkill) · `/resilience` provider decorators + the reliability RULES · `/hosting` nodeHost/httpHost/standingAgent + session stores · `/security` permissions + tool credentials (it absorbed the old identity door) · `/reliability` the retained alias, kept ONLY because it is the sole home of the gate's `CircuitOpenError` · `/skill-graph` the framework-neutral routing layer · `/recipes` the declared unit of agent CONFIGURATION (defineAgentRecipe → `.recipe()`; authoring-time vocabulary, so it stays off the main barrel) · `/maps` the mount kernel's vocabulary (9.58.0: Claim<T> + the engagement lease machine + its renewal feed — pure data and pure functions, no run entry point; mounted via `.maps()`) · `/classify` the calibrated-classifier port (9.104.0: `Classifier`, `typesafe`, `mockClassifier`, `ClassifierError` — a backend that SCORES declared candidates; spent by `.findings({ judge })` and by `classifierScorer` on `/skill-graph`) · `/ontology` the declared map (9.106.0: `defineOntology`, `ontologyHash`, `ontologyPiece`, `ONTOLOGY_INSTRUCTION`, the shapes — what each term IS, how terms RELATE, which SOURCE holds a term and which registered TOOL reads it; pure data and pure functions, no run entry point, no fetch path; mounted via `.ontology()`, served as one request-only system piece per call; 9.112.0 `fromSkos`/`readSkos`/`toSkos` — the SKOS JSON-LD adapter onto the same spec, no second validation path) · `/time` the time layer's conversions for an app outside a run (`convertForTool` — the run's own question of a tool, over its `period` via `sugarForms`/`granularityMsOf` — plus the steps `convertExact`, `convertWidened`, `periodFactProblem`; pure functions over a clock the caller passes; a door of its own because they are the layer's RUN-TIME half, which the main barrel keeps off the default graph, pinned by test/trace-toolpack/browserGraph.test.ts; also `timeReplyPairs`, the reader of a time ask's range and correction pair for a host's front end, which is why the same test pins this door's graph free of Node) · `/ag-ui` the AG-UI protocol adapter over the run's served event stream (`agUi()` — the adapter `streamHandler` on `/hosting` serves runs in; `agUiSerializer` — one run's events → AG-UI events, sub-agents by mount, ids minted from the record's address; `agUiSse` — the second SSE framing strategy, through the optional peer `@ag-ui/encoder`, loaded only when a framing is built). 9.0.0 removed sixteen older paths (`/llm-providers`, `/injection-engine`, `/tool-providers`, `/strategies`, `/observability-providers`, `/identity`, `/stream`, `/thinking`, `/status`, `/locales`, `/debug`, `/debug/finders`, `/memory-providers`, `/embedders`, `/hosting-providers`, `/observability/contextError/finders`) — it removed PATHS, not code; each name still ships through the door that absorbed it. This list is pinned against `package.json` by test/api-conformance/documented-doors.test.ts, and the removed sixteen by subpath-exports.test.ts. **Main barrel does NOT export** mock/browser*/defineMemory/defineSkill/skillGraph/mcpClient/InMemoryStore — import from the doors above.
