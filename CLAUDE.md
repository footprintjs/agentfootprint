# agentfootprint — contributor guide

AgentFootprint builds agents from footprintjs charts. Each runner builds its chart once
and executes through one native footprintjs lifecycle. Stage kinds, `$` methods and
engine handlers belong upstream; they are closed extension seams here. Trust current code.

## Before changing anything

- Search [CAPABILITIES.md](CAPABILITIES.md), rather than reading the whole index; then
  check the nearest export in `src/index.ts`.
- Read the relevant README and scoped rule below before choosing an extension point.
- Keep identifiers injective: use `encodeIdentityField`, with a collision check in the
  same change. The alternative is an explicit domain refusal; never silently rewrite keys.
- Preserve existing source, failures and unrelated work. Use an ordinary branch and PR.

## Definition of done

1. Add behavior tests and run the affected area while working. The full suite must pass
   before completion; send heavy suites, coverage, builds and installs to hosted CI first.
2. Anything touching `src/` needs a fragment in [.changes/](.changes/README.md).
   Never edit `CHANGELOG.md`, bump the package version, or write version numbers; release computes them.
3. A new public capability gets a CAPABILITIES row with Since `unreleased`.
4. A user-visible feature gets a published how-to page and a runnable `examples/` program.
   Feature pages use `<CodeFile region>` to include example code rather than duplicate it.
5. Regenerate with `npm run docs:regen` and commit its output. The `generated` job checks
   the API mirror, docs-truth report, examples index, instruction copies and canonical notes.
6. Fast checks: `npm run lint`, `npm run format`, and `npx tsc --noEmit`.
7. Keep docs separate: API reference is generated from export TSDoc; feature pages explain
   use, one example and gotchas; READMEs, scoped rules, designs and proposals hold internals.
   Never hand-write API signature tables or put design history in a feature page.
   Never link internal guidance from a feature page or ship it in the npm package.
8. Deliver the exact pushed head and proof for independent review. A changed head needs
   a fresh verdict and applicable green gates. Authors do not approve their own changes.

## Release and review

- Lanes author, test, push and open draft PRs. The owner handles final review, normal
  merges, draft readiness, branch updates, release and settings decisions.
- Never use force, `--admin`, `--no-verify` or manual publication.
- A fragment on main makes `.github/workflows/publish.yml` rebuild `release/next`.
  Never edit that branch by hand. Merging its reviewed PR publishes the tested tree.
- Release gates rerun unless `verdict` proves CI passed that exact tree. Red releases nothing.
  Publication tags the release, publishes with provenance, then deploys docs; docs do not hold npm.

## Layering and public doors

- [scripts/layering.config.cjs](scripts/layering.config.cjs) owns `LAYERS` and every fence.
  A top-level source folder occupies exactly one layer, registered before its first file.
- Imports go to the same layer or lower. `UPWARD_ALLOWANCES` stays empty; the named,
  justified `TYPE_ONLY_ALLOWANCES` may only shrink. Do not invent an exception.
- L0 contains leaves such as `lib/`, `events/` and `time/`; core is L9. Root barrels
  and `doors/` are L15 and contain re-exports only, with no registration or other logic.
- `npm run check:layering`, ESLint restricted paths and the architecture test share that table.
- `package.json` exports is exhaustive. The nineteen doors are `.`, `/providers`, `/memory`,
  `/rag`, `/cache`, `/observe`, `/events`, `/context`, `/resilience`, `/hosting`, `/security`,
  `/reliability`, `/skill-graph`, `/recipes`, `/maps`, `/classify`, `/ontology`, `/time`, `/ag-ui`.
- Import providers, context declarations and memory stores from their own doors, not main.
  The complete door and removed-path contract is in [src/doors/README.md](src/doors/README.md).
- Cache strategy follows declared `promptCaching`, never a vendor name; nothing registers at load.

## Module map

One area, one responsibility, then its local contract. Detailed integration history lives
in the scoped rule's `Module contract` sections; this table is the starting point.

| Area | Responsibility and entry to detail |
| --- | --- |
| `core/` | Public runners and native lifecycle — [README](src/core/README.md) |
| `core/agent/` | ReAct chart assembly and stages — [README](src/core/agent/README.md) |
| `core/agent/aroundTurn/` | One invocation wrapper funnel — [README](src/core/agent/aroundTurn/README.md) |
| `core/agent/evidence/` | Pure deterministic evidence gate — [README](src/core/agent/evidence/README.md) |
| `core/slots/` | Three context-slot subflows and thinking — [README](src/core/slots/README.md) |
| `core-flow/` | Native composition charts — [README](src/core-flow/README.md) |
| `patterns/` | Composition recipes, no new control flow — [README](src/patterns/README.md) |
| `tools/` | Tool declarations, dispatch contracts and chains — [README](src/tools/README.md) |
| `answer-validation/` | Exact-candidate validation before delivery — [README](src/answer-validation/README.md) |
| `semantics/coverage/` | Declared absence and coverage envelopes — [README](src/semantics/coverage/README.md) |
| `provider-contract/` | Vendor-independent ports — [README](src/provider-contract/README.md) |
| `adapters/` | Vendor implementations of those ports — [README](src/adapters/README.md) |
| `recorders/core/` | Native signals to served typed events — [README](src/recorders/core/README.md) |
| `recorders/observability/` | Recorders and the one recording producer — [README](src/recorders/observability/README.md) |
| `events/` | Closed event vocabulary and dispatcher — [README](src/events/README.md) |
| `rag/` | Index-time loading and splitting — [README](src/rag/README.md) |
| `memory/` | Stores, retrieval and pipeline mounts — [README](src/memory/README.md) |
| `ontology/` | Declared concepts and their served projection — [README](src/ontology/README.md) |
| `injection-engine/` | Context evaluation, skills and routing — [README](src/injection-engine/README.md) |
| `maps/` | Claim and engagement vocabulary — [README](src/maps/README.md) |
| `recipes/` | Named agent configuration — [README](src/recipes/README.md) |
| `context-bisect/` | Ablations and backtrack views — [README](src/context-bisect/README.md) |
| `context-ledger/` | Recorded offers, uses and outcomes — [README](src/context-ledger/README.md) |
| `influence-core/` | Deterministic scoring proxies, never causality — [README](src/influence-core/README.md) |
| `tool-lint/` | Build-time catalog confusability checks — [README](src/tool-lint/README.md) |
| `trust-boundaries/` | Bounded opt-in boundary evidence — [README](src/trust-boundaries/README.md) |
| `trace-toolpack/` | Record-based self-explanation tools — [README](src/trace-toolpack/README.md) |
| `time-travel/` | Recorded stops and served-view reads — [README](src/time-travel/README.md) |
| `answer-account/` | Vouched answer explanations — [README](src/answer-account/README.md) |
| `mcp/` | Tool transport in both directions — [README](src/mcp/README.md) |
| `ag-ui/` | One served run translated to a frontend — [README](src/ag-ui/README.md) |
| `lib/` | L0 leaves, not feature libraries — [README](src/lib/README.md) |
| `lib/conventions.ts` | Builder/recorder protocol — `INJECTION_KEYS`, `stageRole`, `milestoneFor` |

## Native run invariants

- One invocation owns each runner instance. Native `ERR_RUN_IN_FLIGHT` runs before callbacks.
  Context, continuation, checkpoint tracking, causal evidence, meter and resources belong
  to the actual native component; independent mounts never share these values.
- Build charts once. Close over per-run accessor lambdas; captured fields go stale on run two.
- Scope state must survive `structuredClone`: closures hold functions; scope carries plain data.
  `core/agent/types.ts · AgentState` owns its mutability and mapper contracts.
- Use admitted native identity and actual component/stage coordinates. Distinguish a resumed
  leg from retained log identity; never parse ID spelling or borrow a selected/latest run.
- Subscribe before `run()`: listener gating drops events rather than queuing them for later.
- Event payloads are detached plain data. Private reducers and the native scoped recorder
  stay inline when public observers are deferred; memory writers use their native mapper.
- Events fire before the emitting stage commits. Join them to commits by `runtimeStageId`,
  never arrival order. `EmitBridge.ts · onEmit` delegates metadata construction to `buildEventMeta`.
- `configureAgent` in `core/agent/runtime/configuration/configure.ts` defaults to summary
  reads and delta commits. Read values with `commitValueAt`, never `bundle.overwrite[key]`.
- Recorders do not read AgentState. `ContextRecorder.onWrite` attributes convention-key writes
  to that write's own `runtimeStageId`, including parallel slot subflows.
- `$break` is the clean stop. Structured failure fields reach the native terminal owner's
  `finalizeResult`; do not turn a policy/reliability failure into a successful answer.
- Keep `ArrayMergeMode.Replace` on every loop-crossed mount in `buildAgentChart` and
  `buildDynamicAgentChart`; default concatenation duplicates injections on each iteration.
- Keep the required context selector `failFast: true`; all-settled would allow a half-built call.
- Keep tool names and memory IDs unique at construction. Dispatch is by name; renaming changes behavior.
- Every saved run goes through `recordRun`, with `snapshot`, `events` AND build-time `structure`.
  Wire all three BoundaryRecorder connections; a finished run cannot reconstruct missing evidence.

## Silent-bug landmines

- The executable provider catalog belongs to the native component. Discover refreshes it
  each iteration; both resume strategies reacquire it before dispatch. Never copy an old cache.
- Classic ReAct caches by skipping re-selection after turn one. Changing its selector turns
  it dynamic; classic with skills cannot activate a later skill correctly. Use dynamic mode.
- Branch IDs are bare `final` / `tool-calls`, not prefixed subflow IDs. `stageRole` and
  `milestoneFor` deliberately recognize both forms; matchers must not erase that distinction.
- `src/observability/` implements finders; `recorders/observability/` contains recorders.
  Tool credentials in `src/identity.ts` differ from tenant scoping in `memory/identity/`.
  Resilience decorators differ from the reliability rule gate.
- Evidence gates detect unsupported claims, not truth. Scores in influence-core are proxies.
  Backtrack cards are correlational bounds; causal claims require the scoped ablation proof.

## Scoped rules: read the area you change

These files carry the complete contracts and blast-radius notes for their declared paths.

| Area | Contract |
| --- | --- |
| Core, tools, compositions, gates, ontology, recipes | [agent-loop](.claude/rules/agent-loop.md) |
| Events, recorders, finders and bridges | [events and observability](.claude/rules/events-and-observability.md) |
| Provider ports, adapters, MCP and resilience | [providers and adapters](.claude/rules/providers-and-adapters.md) |
| Memory stores, retrieval and RAG | [memory and RAG](.claude/rules/memory-and-rag.md) |
| Injections, skills, cursor and mounts | [injection and skills](.claude/rules/injection-and-skills.md) |
| Hosting, identity, ingress and frontend trust | [hosting and security](.claude/rules/hosting-and-security.md) |
| Artifacts, semantic results and code runners | [artifacts and semantics](.claude/rules/artifacts-and-semantics.md) |
| Pause/resume, retries and counterfactual replay | [backtracking](.claude/rules/backtracking.md) |

## Working references

- [examples/](examples/) owns canonical consumer imports; `package.json` owns exported paths.
- [src/lib/conventions.ts](src/lib/conventions.ts) owns internal stage/subflow names and recorder keys.
- `.claude/rules/backtracking.md` retains M1–M7 and the full native continuation contract.
- Source tests guard the fences. `test/docs/claude-guide.test.ts` caps this guide at 200 lines.
- The PR's rule-location table accounts for every contract moved out of the previous guide.
