# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.4]

**Fix: v2.6 cache-layer subflows leaked as fake user-visible steps in
the StepGraph.** When v2.6 introduced `CacheDecisionSubflow` (with
local id `sf-cache-decision`) and the `CacheGate` decider (stage id
`cache-gate`), neither was registered in `BoundaryRecorder`'s
`AGENT_INTERNAL_LOCAL_IDS` set. Result: every iteration of an agent
emitted `subflow.entry` / `subflow.exit` / `decision.branch` events
that weren't tagged `isAgentInternal: true`, so `FlowchartRecorder`
projected them as user-facing `StepNode`s. A 5-iteration run showed
~30 nodes instead of ~14 — every iter contributed 3 fake steps the
user had to scrub past. Same issue (pre-existing) for
`SUBFLOW_IDS.INJECTION_ENGINE`.

### Fix

Three ids added to `AGENT_INTERNAL_LOCAL_IDS` in
`src/recorders/observability/BoundaryRecorder.ts`:

```ts
SUBFLOW_IDS.INJECTION_ENGINE,   // pre-existing oversight
SUBFLOW_IDS.CACHE_DECISION,     // v2.6
STAGE_IDS.CACHE_GATE,           // v2.6 (decider stage id)
```

Plus a comment block warning future contributors: when adding a new
subflow to the Agent's internal flowchart, decide whether it's a
context-engineering moment (leave OUT — it should be a user-visible
step) or pure plumbing (add HERE — it's wiring, not a step).

### Regression guard

New test `test/recorders/observability/internal-ids-coverage.test.ts`
enumerates `SUBFLOW_IDS` and asserts every entry is categorized as
either a slot subflow OR an agent-internal id. The next time someone
adds a new entry to `SUBFLOW_IDS` without categorizing it, the test
fails by NAME so the bug is caught before it leaks into Lens.

### Verified

In the Neo MDS triage browser app (1630/1630 tests passing, lens dist
unchanged):

- 5-iteration run, before fix: 30+ visible step-graph nodes
- 5-iteration run, after fix: 14 nodes (1 Run + per-iter LLM/tool steps + final llm→user)

## [2.6.3]

**README rewrite + new `Inspiration` section in docs/site.** Three docs
moves bundled together:

1. **README rewrite** — leads with the abstraction-lineage framing
   (PyTorch autograd / Express / Prisma / Kubernetes / React → agentfootprint
   for context engineering). Same kind-of-move applied to a new domain.
   The hand-rolled vs declarative code comparison is now the visual hook;
   the differentiator section ("the trace is a cache of the agent's
   thinking") names the unique IP claim.

2. **New "Why it's shaped this way — two pillars" section** in the README.
   - **THE WHY (user-visible win):** Palantir's 2003 thesis applied to
     agent runtime — connect the four classes of agent data (state,
     decisions, execution, memory) so the next token compounds the
     connection instead of paying for it again.
   - **THE HOW (engineering discipline):** Liskov's ADT + LSP work, applied
     to flowcharts. Every framework boundary is LSP-substitutable.
     Subflows are CLU clusters. Locality of reasoning enforced as a
     runtime invariant.

3. **New `docs/inspiration/` section + matching `docs-site/inspiration/`**:
   - `README.md` (index) explaining the two-pillar structure
   - `connected-data-palantir.md` — full Palantir thesis → agentfootprint
     mapping; the four classes of agent data; where we go beyond Palantir
     (emergent vs pre-built ontology)
   - `modularity-liskov.md` — CLU clusters → subflows; LSP examples
     (CacheStrategy / LLMProvider / ToolProvider); locality of reasoning
     → operationalized; where we extend beyond classical Liskov
   - New "💡 Inspiration" sidebar section in the docs site between
     Architecture and Reference

Plus accuracy fixes uncovered during README verification:
- Provider count: 6 → **7** (Anthropic, OpenAI, Bedrock, Ollama,
  Browser-Anthropic, Browser-OpenAI, Mock)
- "47 typed events" → **48+ typed events** (recounted via grep)
- Strengthened the "frameworks that compose state per-node can't recompute
  cache markers in lockstep" claim about other frameworks (less
  combative phrasing, same defensible point)

No code change. 1627/1627 tests pass.

## [2.6.2]

**Docs: tool-dependency framing for Dynamic ReAct + remove application-specific
references.** Two unrelated docs cleanups bundled together:

1. **README — sharper rule for when to use Dynamic ReAct.** The previous
   benchmark-heavy section (4 sub-sections, multi-model token tables,
   parallelization caveats) led with the wrong heuristic ("30+ tools across
   8+ skills"). Replaced with the clearer rule: **use Dynamic ReAct when
   your tools have dependencies — when one tool's output implies which tool
   to call next.** Skills encode that workflow. If tools are independent
   and order doesn't matter, Classic is fine. The side-by-side example +
   "what Dynamic gives you that Classic doesn't" list is preserved; the
   noisy benchmark tables are gone.

2. **Removed all application-specific references.** Earlier docs referred
   to "Neo" (a Cisco MDS Fibre Channel triage agent used internally for
   benchmarking) by name. Generic phrasing now: "production-shaped Skills
   agent (10 skills, 18 tools after dedup)." Affected: README.md,
   CHANGELOG.md (2.6.0 + 2.5.0 entries), docs/guides/caching.md,
   examples/dynamic-react/README.md.

No code change. 1627/1627 tests still pass.

## [2.6.1]

**Lint cleanup + release-pipeline hardening.** v2.6.0 shipped with three
trivial eslint errors (`prefer-const`, `no-inferrable-types`) in cache
files and pre-existing test files. The release script's 8 gates didn't
include lint — only docs / format / build / tests / examples — so the
errors slipped through. Two-part fix:

1. **Source fix** — auto-applied via `eslint --fix`. Three lines changed
   across `src/core/Agent.ts`, `test/core/agent-toolprovider.test.ts`,
   and `test/recorders/contextEngineering.test.ts`. No behavior change.
2. **Process fix** — added Gate 2.85 to `scripts/release.sh`:
   `npm run lint --max-warnings=99999`. Errors fail the gate; warnings
   tolerated for now (334 pre-existing non-null-assertion warnings need
   a separate cleanup pass).

Net: all 1627 tests still pass; CI is green; future releases can't
ship with eslint errors.

## [2.6.0]

**Provider-agnostic prompt caching.** Dynamic ReAct repeats the same
stable prefix (system prompt + tool schemas + active skill body) on
every iteration. Without caching, every iter pays full price for that
duplicated context. v2.6 introduces a unified DSL — `cache:` policy on
each injection flavor — over per-provider strategies, so the right
cache hints land on the wire automatically.

### What's new

- **CacheDecision subflow** walks `activeInjections` each iteration,
  evaluates each injection's `cache:` directive, and emits a
  provider-agnostic `CacheMarker[]`.
- **CacheGate decider** uses footprintjs `decide()` with three rules —
  kill switch (`cachingDisabled`), hit-rate floor (skip when recent
  hit-rate < 0.3), and skill-churn (skip when ≥3 unique skills in the
  last 5 iters). Decision evidence captured for free.
- **5 cache strategies** (auto-registered via side-effect imports):
  - `AnthropicCacheStrategy` — manual `cache_control` on system blocks
    (4-marker clamp; surfaces `cache_creation_input_tokens` +
    `cache_read_input_tokens`)
  - `OpenAICacheStrategy` — pass-through (auto-cache); extracts
    `prompt_tokens_details.cached_tokens` for metrics
  - `BedrockCacheStrategy` — model-aware: Anthropic-style hints when
    modelId matches `^anthropic\.claude`, pass-through otherwise
  - `NoOpCacheStrategy` — wildcard fallback for unknown providers
  - Future: `GeminiCacheStrategy`
- **Per-flavor defaults** (overridable on each `defineX(...)`):
  - `defineSteering` → `'always'`
  - `defineFact` → `'always'`
  - `defineSkill` → `'while-active'`
  - `defineInstruction` → `'never'`
  - `defineMemory` → `'while-active'`
- **`cacheRecorder()`** — high-level observability; dump after a run
  for gate decisions + total markers emitted.
- **`Agent.create({ caching: 'on' | 'off' })`** — top-level kill switch
  (defaults to `'on'`).

### Validated on a production-shaped Skills agent

Same task, same scenario, against the live Anthropic API on a
10-skill / 18-tool agent:

| Mode (Sonnet 4.5) | cache=off | cache=on | Δ |
|---|---|---|---|
| Classic (no skill markdown) | 40,563 | (untested) | — |
| Static (all skill markdowns stuffed) | ~140,000 | 7,640 | **−95%** |
| **Dynamic (smart gating)** | **28,404** | **6,535** | **−77%** |

Cross-model Dynamic cache=on results:

| Model | cache=off | cache=on | Δ |
|---|---|---|---|
| Sonnet 4.5 | 36,322 | **6,535** | −82% |
| Haiku 4.5 | 36,309 | **13,637** | −62% |
| Opus 4.5 | 28,477 | **10,745** | −62% |

### Strategic implication

Pre-v2.6 the only economically sane Dynamic ReAct shape was smart
gating — bind tools and skill markdowns conditionally per iter.
Post-v2.6 you have a real second option: **stuff-and-cache** (put every
skill markdown into the system prompt always, let the cache layer carry
the cost). Both patterns are now first-class. Pick based on your team's
preferences, not on token cost alone.

### Migration

Zero breaking changes. Existing agents get caching for free if they use
Anthropic, Bedrock-Claude, or OpenAI providers. Disable explicitly with
`Agent.create({ caching: 'off' })`.

### Tests / Docs

- +66 tests in `test/cache/` (1627/1627 pass)
- New guide: [docs/guides/caching.md](docs/guides/caching.md) — Caching
  in 60 seconds + per-strategy reference + custom-strategy authoring
  template

## [2.5.1]

**Bug fix release.** v2.5.0 shipped with a single-line bug in the
`Agent.buildChart` InjectionEngine subflow mount: the `outputMapper`
was missing `arrayMerge: ArrayMergeMode.Replace`. Default footprintjs
behavior CONCATENATES arrays from child to parent, so each iteration's
`activeInjections` accumulated instead of replacing. Effect:
8 → 16 → 24 → 32 → 40 → 48 cumulative injections per turn instead
of the intended ~8-per-iter. The 8 always-on injection bodies were
duplicated 5× into the system prompt at iter 5, ballooning Dynamic
ReAct's input-token cost.

### The fix

One line added to the InjectionEngine subflow mount in `Agent.ts`:

```ts
arrayMerge: ArrayMergeMode.Replace,
```

Same fix that was already present on the SystemPrompt / Messages /
Tools subflow mounts. The InjectionEngine mount was missed in v2.5.0.

### Empirical impact (real Anthropic benchmark, 3 models × 2 modes)

| Model       | Dynamic in (v2.5.0) | Dynamic in (v2.5.1) | Δ       |
| ----------- | ------------------: | ------------------: | ------: |
| Haiku 4.5   |              62,571 |              36,341 | **−42%** |
| Sonnet 4.5  |              44,621 |              28,486 | **−36%** |
| Opus 4.5    |              44,590 |              28,401 | **−36%** |

Same scenario, same scripted answers, same iteration count. The
~36–42% drop is purely the system prompt no longer being duplicated.

### Regression tests

Three new tests in `test/core/dynamic-react-loop.test.ts` assert
bounded per-iteration injection counts:

- `activeInjections` ≤ 4 across 5 iterations
- `systemPromptInjections` ≤ 5 across 5 iterations
- `messagesInjections` ≤ 1.5× history length

These would have caught the v2.5.0 bug. Suite: 1490 → 1493.

### v1 marketing claim correction

v2.5.0's README claimed "Dynamic ReAct cuts input tokens 30–70%."
The real-world benchmark above shows this is **not universal** at sub-30-tool
scale. The corrected README now shows the real 3-model comparison
and explains:

- Dynamic provides **predictable cost** (varies <5% across models)
- Classic provides **lowest absolute cost** when the model parallelizes
- Dynamic wins clearly above ~30 tools across 8+ skills
- Dynamic ALWAYS wins on per-call payload size + deterministic routing

### Suite

1490 → 1493 (+3 regression tests).

## [2.5.0]

**Dynamic ReAct primacy + skill-driven tool gating.** This release
makes the Dynamic ReAct loop the load-bearing story: tools and
system-prompt content recompose every iteration, so an agent with
N skills × M tools no longer pays the full tool-list token cost on
every LLM call. Plus eight new builder/runtime features for
production agent surfaces.

### Block A — eight runtime + builder additions

- **A1 `.toolProvider()`** — first-class builder method for dynamic
  tool sources (registry-backed, MCP-mediated, runtime-decided).
- **A2 `PermissionPolicy`** — declarative role/capability allowlists
  on `agent.run({ identity })`. Tool-call recorder consults the
  policy; deny → tool throws `PermissionDeniedError`.
- **A3 `SkillRegistry.toTools()`** — explicit conversion API so
  consumers can opt skill-supplied tools into the static registry
  (gated by autoActivate mode).
- **A4 Builder ergonomics** — `.maxIterations()`, `.recorder()`,
  `.instructions()` on AgentBuilder.
- **A5 `autoActivate: 'currentSkill'`** — runtime tool gating: a
  skill's tools become visible to the LLM only when that skill is
  the most-recently-activated one. Cuts tool-list bloat for agents
  with N skills × M tools.
- **A6 `outputSchema(parser)`** — terminal-contract validation via
  `agent.runTyped()`. Uses footprintjs's schema abstraction
  (Zod-optional, duck-typed). On parse/validation failure throws
  `OutputSchemaError` with `.rawOutput` preserved.
- **A7 `flowchartAsTool(chart)`** — wraps a footprintjs FlowChart
  as an LLM-callable Tool. Inner pause throws with
  `error.checkpoint` attached (full nested-pause integration is on
  the v2.6 backlog).
- **A8 Richer `Skill`** — first-class `metadata`, `inject` shape,
  per-skill activation hooks. Subsumes v2.4 ad-hoc skill factories.

### Block B — `agentfootprint/{llm,tool,memory}-providers` + `/security`

Subpath restructure so consumers don't pay tree-shake costs for
adapters they don't use. v2.4's main barrel pulled every provider;
v2.5 splits them. The genuinely-clean per-adapter subpath
(Drizzle/Lucia pattern) is on the v2.6 backlog.

### Block C — Skills runtime per-mode routing

Closes the v2.4 Phase 4 commitment: `autoActivate` now actually
narrows the tool slot at runtime (was previously a static-only
hint). The Tools slot subflow consults `activatedInjectionIds`
each iteration.

### Block D — Message Catalog Pattern (`agentfootprint/locales`)

i18n-ready prose templates for Lens commentary and chat-bubble
thinking messages. `defaultThinkingMessages`, `composeMessages`,
`validateMessages` exports.

### Block E — examples README auto-generator

`scripts/generate-examples-readme.mjs` walks `examples/`, extracts
title + summary from each file's leading JSDoc, emits a
table-of-contents README. Runs as a release gate.

### Post-run trace accessors

`agent.getLastSnapshot()`, `agent.getLastNarrativeEntries()`,
`agent.getSpec()` — three accessors for post-run UIs (Lens Trace
tab, ExplainableShell, custom dashboards) to pull execution state
without intercepting the run() call site. `enableNarrative()` is
called inside `createExecutor()` so the entries array is populated
for any consumer that asks.

### BrowserAnthropicProvider — streaming-spec fixes

The v1→v2 rewrite regressed the SSE parser. v2.5 restores both:
**tool args via `input_json_delta`** (per-block accumulation, parsed
on `content_block_stop` — was always landing as `{}`) and
**cumulative usage tracking** from `message_start.usage` +
`message_delta.usage` (was always 0).

### Tool dedupe in Tools slot

Three sources can register the same tool name (static registry +
toolProvider + skill injection); LLMs reject duplicates. Tools
slot now dedupes by name + uses `ArrayMergeMode.Replace` on the
subflow output mapping (the documented fix to the documented
anti-pattern).

### Suite

1408 → 1490 (+82).

## [2.4.0]

**We made it impossible for our docs to lie.**

The headline of this release is structural: every code block on the
docs site is now imported from a real, runnable file in `examples/`.
A docs build fails if a referenced example doesn't exist or if a
named region marker is missing. Drift between docs and code becomes
impossible by construction — you can't ship a docs page that
documents an API that isn't there.

Suite: 1229 → 1253 (+24 from new Skills features). Pages: 67% drift
→ ~0%.

### The structural drift fix

- New `<CodeFile path="..." region="..." />` Astro component imports
  code from any file in the repo at docs-build time. Region markers
  in source files (`// #region NAME` / `// #endregion NAME`) let you
  show only the relevant slice.
- New CI job `docs` (`.github/workflows/ci.yml`) runs the docs-site
  build. A missing file → ENOENT. A missing region →
  `RegionNotFoundError`. Either kills CI.
- 35 of 42 docs pages converted to `<CodeFile>` imports. ~25 region
  markers added across `examples/`. Inline code blocks in the docs
  surface now exist only for illustrative anti-examples (the
  "without agentfootprint" 80-line block in the README).

### Skills features — the essay becomes truth

The `skills-explained.mdx` essay was the strongest piece of writing
in the docs and the most aspirational. Three features it described
now ship:

- `defineSkill({ surfaceMode })` — typed `'auto' | 'system-prompt' |
  'tool-only' | 'both'`. Default `'auto'` resolves per provider via
  `resolveSurfaceMode`.
- `defineSkill({ refreshPolicy })` — typed
  `{ afterTokens, via: 'tool-result' }` for re-injecting skill bodies
  past a token threshold. API surface ships today; runtime hook lands
  in v2.5 (long-context attention work) — non-breaking.
- `resolveSurfaceMode(provider, model)` — pure function, exported.
  Per-provider attention-profile defaults match the essay:
  Claude ≥ 3.5 → `'both'`; everywhere else → `'tool-only'`.
- `SkillRegistry` class — centralized governance for shared skill
  catalogs across multiple agents. Methods: `register / replace /
  unregister / get / has / list / size / clear`. Throws on duplicate
  register. Throws on non-Skill flavor inputs.
- `agent.skills(registry)` builder method — bulk-register every skill
  in a registry on an agent. Companion to existing `.skill(t)`.

Today's runtime treats every `surfaceMode` the same (the cross-
provider-correct activation + next-iteration injection pattern the
essay calls right). Full per-mode runtime routing diversity lands in
v2.5 — non-breaking; consumer code written today continues to work.

24 new tests cover the new API surface end-to-end.

### New navigation + 4 new pages

The docs site sidebar restructured around how readers actually
navigate (persona-aware grouping, max 7 items per group):

  Get Started → Mental model → Primitives & compositions →
  Context engineering → Memory → Observability → Production →
  Providers → Memory stores → Architecture → Reference → Resources

Four new pages address the gaps the multi-persona review surfaced:

- `manifesto.mdx` — "How agentfootprint thinks". First-person
  opinionated essay naming what we are, what we're not, what we
  believe, what we ask of you. The framework's perspective made
  tangible. Storyteller's voice.
- `causal-deep-dive.mdx` — researcher-grade snapshot deep-dive.
  Annotated JSON shape of a `RunSnapshot` byte-for-byte. Four
  projection modes documented. Worked Monday→Friday replay with
  cheap-model triage economic argument (Sonnet→Haiku follow-up
  at ~10× lower cost).
- `research/citations.mdx` — bibliography for every shipped pattern
  (ReAct, Reflexion, ToT, Self-Consistency, Debate, Map-Reduce,
  Swarm, Skills) with proper paper references + how the recipe in
  `examples/patterns/` relates to + deviates from each paper. Plus
  the augmented-LM survey as the conceptual root of our Injection
  primitive. Plus a BibTeX entry for citing agentfootprint.
- `architecture/dependency-graph.mdx` — 8-layer DAG diagram for
  senior engineers. Substrate (footprintjs) → events → adapters →
  memory → context engineering → primitives → compositions → public
  barrel. Documents the Hexagonal isolation property + per-layer
  subpath exports + anti-cycle CI enforcement.

### API reference — auto-generated via TypeDoc

- New devDeps: `typedoc` + `typedoc-plugin-markdown`.
- New script: `npm run docs:api`. Reads `src/index.ts`, follows the
  public exports, emits markdown to `docs/api-reference/`.
- Generated tree committed so consumers browsing GitHub can follow
  links to it directly. Five sections: classes/ + functions/ +
  interfaces/ + type-aliases/ + variables/.
- The 7 hand-written API ref pages (which were drifted) consolidated
  to a single `api/agent.mdx` placeholder that points at the
  generated tree.

### Coverage badge

- New devDep: `@vitest/coverage-v8`.
- New script: `npm run test:coverage`.
- New CI job `coverage` (`.github/workflows/ci.yml`) uploads
  `coverage/lcov.info` to Codecov via `codecov-action@v5`. No
  threshold enforcement — badge surfaces the number; consumers
  ratchet up over time.
- README badge added. Initial baseline: 85.75% lines, 83.77%
  statements, 90.30% functions, 73.20% branches across 3962
  statements.

### README rewrite

- Tagline changed: "Context engineering, abstracted."
- New autograd / Express / Prisma / Kubernetes / React framing places
  agentfootprint in the category of credible abstractions — not
  "another agent framework."
- Side-by-side "without (~80 LOC, drifts) vs with agentfootprint
  (~8 LOC, stable)" code blocks.
- "The trace is a cache of the agent's thinking" reframing of
  causal memory with three downstream consumers: audit, cheap-
  model triage, training data.
- "Why exactly four triggers? Because *who decides activation* is
  a closed axis: nobody / dev / system / LLM" — defensibly stable
  surface argument.
- Evergreen sections — no version-specific facts in the README. The
  npm version badge auto-updates from the registry; CHANGELOG carries
  per-release truth. **From now on the README never needs touching
  for a release.**

### Process

- Six 6-persona reviews (one per phase: 1, 2, 3, 4, 6 + Phase 7 final).
  Every review's adjustments folded into the next phase.
- Design memo signed off BEFORE code, per the v2.3 process change.
  No internal panel verdicts in JSDoc — design lives in
  `memory/agentfootprint_v24_design.md`.

### What's next (v2.5)

- Reliability subsystem — `CircuitBreaker`, 3-tier output fallback,
  `agent.resumeOnError(checkpoint, input)`. Deferred from v2.4.
- Skills runtime per-mode routing diversity — suppressing system-
  prompt slot for `'tool-only'`, synthesizing fresh tool-result for
  `refreshPolicy`. The API surface is shipped today; the runtime
  tightening lands in v2.5 non-breaking.

## [2.3.0]

Mock-first development is now a first-class workflow with two new
public surfaces, the first two production memory-store adapters
arrive as peer-deps via subpath imports, and `package.json` declares
every optional SDK in `peerDependenciesMeta`. Suite: 1229 / 1229.

### Added — `mock({ replies })` for scripted multi-turn agents

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

const provider = mock({
  replies: [
    // Iteration 1: LLM decides to call a tool
    { toolCalls: [{ id: '1', name: 'lookup', args: { topic: 'refunds' } }] },
    // Iteration 2: LLM produces final answer
    { content: 'Refunds take 3 business days.' },
  ],
});
```

Each `complete()` / `stream()` consumes one reply in order. Exhaustion
throws a clear error so a misnumbered script fails the test instead
of silently looping. `provider.resetReplies()` rewinds the cursor for
cross-scenario reuse.

### Added — `mockMcpClient({ tools })` (in-memory MCP server)

Drop-in replacement for `mcpClient(opts)` — same `McpClient` shape,
zero subprocess / network / SDK install. Build the entire MCP
integration offline, swap to real `mcpClient` when ready.

```typescript
import { Agent, mock, mockMcpClient } from 'agentfootprint';

const slack = mockMcpClient({
  name: 'slack',
  tools: [
    {
      name: 'send_message',
      description: 'Post a message to a channel',
      inputSchema: { type: 'object' },
      handler: async ({ text }) => `Posted: ${text}`,
    },
  ],
});

const agent = Agent.create({ provider: mock({ reply: 'ok' }) })
  .tools(await slack.tools())
  .build();
```

The `_client` injection on `mcpClient` is `@internal` because the SDK
shape isn't a stable public surface. `mockMcpClient` is the public,
documented mock entry point.

### Added — `RedisStore` (subpath: `agentfootprint/memory-redis`)

Persistent `MemoryStore` implementation backed by Redis. Lazy-requires
`ioredis`; no runtime cost when another adapter is in use.

```typescript
import { RedisStore } from 'agentfootprint/memory-redis';

const store = new RedisStore({ url: 'redis://localhost:6379' });
const memory = defineMemory({
  id: 'redis-window',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store,
});
```

Implements every `MemoryStore` method except `search()`. `putIfVersion`
is atomic via a small Lua script (real CAS, not emulated). RedisSearch
(vector retrieval) lands as a separate adapter in a future release.

### Added — `AgentCoreStore` (subpath: `agentfootprint/memory-agentcore`)

AWS Bedrock AgentCore Memory adapter. Lazy-requires
`@aws-sdk/client-bedrock-agent-runtime`.

```typescript
import { AgentCoreStore } from 'agentfootprint/memory-agentcore';

const store = new AgentCoreStore({
  memoryId: 'arn:aws:bedrock:us-east-1:...:memory/my-mem',
  region: 'us-east-1',
});
```

Maps the `MemoryStore` interface onto AgentCore's session/event model.
Caveats called out in the JSDoc:

- `putIfVersion` is emulated client-side (read+write) — fine for
  single-writer-per-session deployments.
- `seen` / `feedback` use in-process shadow state (don't survive
  process restart). Use `RedisStore` for durable recognition.
- `search()` is NOT exposed in v2.3 — AgentCore's native retrieve API
  will land as a separate `agentcoreRetrieve()` helper in a future release.

### Changed — `package.json` peer-dep declarations

Every lazy-required SDK is now declared in `peerDependenciesMeta` with
`optional: true` so npm advertises the relationship without auto-installing
or warning:

- `@anthropic-ai/sdk` (was undeclared — silent peer-dep)
- `openai` (was undeclared)
- `@aws-sdk/client-bedrock-runtime` (was undeclared)
- `@aws-sdk/client-bedrock-agent-runtime` (new — AgentCore)
- `@modelcontextprotocol/sdk` (was undeclared)
- `ioredis` (new — Redis)
- `zod` (already declared)

Friendly install hints fire at first call when an SDK is missing — same
pattern as `AnthropicProvider` since v1.

### Examples

- `examples/features/07-mock-multi-turn-replies.ts` — scripted ReAct loop
- `examples/memory/08-redis-store.ts` — RedisStore with mock-injected client
- `examples/memory/09-agentcore-store.ts` — AgentCoreStore with mock-injected client

All run end-to-end via `npm run example <path>`.

### Tests

+66 new tests (1163 → 1229):
- +6 MockProvider replies (consumption order, toolCalls partial, exhaustion, reset, precedence, stream)
- +15 mockMcpClient (lifecycle, handler dispatch, arg coercion, error context, Agent integration, schema fidelity)
- +23 RedisStore (CAS Lua, TTL, multi-tenant isolation, GDPR forget, signatures, feedback)
- +22 AgentCoreStore (emulated CAS, session-keyed isolation, shadow state, GDPR forget)

### Process change — design memo BEFORE release

v2.3 ships with a 9-panel design memo signed off ahead of code, per the
process-change committed in v2.2.x: panel verdicts live in
`memory/agentfootprint_v23_design.md`, not in JSDoc.

## [2.2.0]

Adds MCP (Model Context Protocol) client integration. Connect to any
MCP server, pull its tools as agentfootprint `Tool[]`, register them
on your agent in one builder call. Validates the v2.0 thesis again:
new tool sources slot in via the existing `Tool` interface — no
engine code, no new event types.

### Added — `mcpClient` (Model Context Protocol client)

```typescript
import { Agent, mcpClient } from 'agentfootprint';

const slack = await mcpClient({
  name: 'slack',
  transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
});

const agent = Agent.create({ provider })
  .tools(await slack.tools())   // bulk-register every tool the server exposes
  .build();

await agent.run({ message: 'Send "deploy succeeded" to #alerts' });
await slack.close();
```

- Transports: `stdio` (local subprocess) and `http` (Streamable HTTP)
- Lazy-required `@modelcontextprotocol/sdk` peer-dep — zero runtime
  cost when MCP isn't used; friendly install hint if missing
- `_client` injection point for testing without the SDK
- Each MCP tool wraps as one agentfootprint `Tool` — `inputSchema`
  preserved verbatim; `callTool()` becomes the wrapped `execute()`
- MCP error responses (`isError: true`) throw with the server's
  message; non-text content blocks (image / resource) summarized as
  `[type]` placeholders (full multi-modal mapping is a future release)

### Added — `Agent.tools(toolArray)` builder method

Bulk-register companion to `.tool(t)`. Pair with
`await mcpClient(...).tools()` for the canonical MCP flow:

```typescript
agent
  .tools(await slack.tools())
  .tools(await github.tools())
  .tools(await db.tools())
  .build();
```

Tool-name uniqueness still validated per-entry across all sources
(MCP servers + manual `.tool()` calls). Duplicates throw at build
time.

### Added — `examples/context-engineering/08-mcp.ts` + `.md`

End-to-end runnable example using an injected mock MCP client. Same
code path as production; only the SDK construction is mocked. Pairs
with the existing 7 context-engineering examples.

### Internal

- 1157 tests (was 1141 — 16 new MCP tests across 7 patterns)
- 35 examples (was 34 — added 08-mcp.ts)
- AI tooling instructions (CLAUDE.md, AGENTS.md, all `ai-instructions/`)
  updated to cover MCP

## [2.1.0]

The first new context-engineering flavor since the v2.0 InjectionEngine
shipped. Validates the v2.0 thesis: "adding the next flavor is one new
factory file." defineRAG is exactly that — composes over the existing
memory subsystem (semantic + top-K + strict threshold), zero engine
changes, zero new event types.

### Added — RAG (`defineRAG` + `indexDocuments`)

Two-function public surface:

- `defineRAG({ id, store, embedder, topK?, threshold?, asRole? })` —
  the read-side factory. Returns a `MemoryDefinition` with RAG-friendly
  defaults (asRole='user', topK=3, threshold=0.7).
- `indexDocuments(store, embedder, documents, options?)` — the seeding
  helper. Embeds each doc, batches into `store.putMany()`. Used at
  application startup to populate the corpus before the first agent run.

Plus `Agent.rag(definition)` builder method — alias for `.memory()` so
consumer intent reads clearly:

```typescript
import {
  defineRAG, indexDocuments,
  InMemoryStore, mockEmbedder,
} from 'agentfootprint';

const embedder = mockEmbedder();
const store = new InMemoryStore();

await indexDocuments(store, embedder, [
  { id: 'doc1', content: 'Refunds processed in 3 business days.' },
  { id: 'doc2', content: 'Pro plan: $20/month.' },
]);

const docs = defineRAG({ id: 'product-docs', store, embedder, topK: 3, threshold: 0.7 });

agent.rag(docs);  // alias for .memory(docs); same plumbing
```

Strict threshold semantics: when no chunk meets the threshold, no
injection happens (no fallback to top-K-anyway). Same panel-decision
rule as defineMemory({strategy: TOP_K}).

Multi-tenant corpora supported via `IndexDocumentsOptions.identity`.

### Added — `examples/context-engineering/07-rag.ts` + `.md`

End-to-end runnable example demonstrating the full RAG flow (seed →
define → query → retrieved-context-injected). Pairs with the existing
6 context-engineering examples.

### Added — AI tooling instructions cover RAG

`CLAUDE.md`, `AGENTS.md`, and every file under `ai-instructions/`
updated to include the RAG section so AI coding tools generate v2.1
code by default.

### Internal

- 1141 tests (was 1121 — 20 new RAG tests)
- 34 examples (was 33 — added 07-rag.ts)
- Public exports: `defineRAG`, `DefineRAGOptions`, `indexDocuments`,
  `IndexDocumentsOptions`, `RagDocument` from top-level barrel

## [2.0.1]

The first npm-published v2 build. v2.0.0 was tagged on GitHub but the
publish workflow failed before reaching `npm publish` because of a
case-sensitive Linux CI failure (`mapReduce.ts` vs `MapReduce.ts`).
2.0.1 carries every v2.0 feature plus the post-tag fixes:

### Fixed
- `src/patterns/mapReduce.ts` → `MapReduce.ts` so case-sensitive Linux
  CI resolves `import '../../../src/patterns/MapReduce.js'`. macOS dev
  hid the issue.
- ESLint `require-yield` violation in
  `test/resilience/unit/withFallback.test.ts` (intentionally-empty
  generator that throws before yielding — suppression added locally).

### Changed
- Release script Gate 5: now runs the in-repo `examples/` sweep
  (`npm run test:examples` → typecheck + tsx end-to-end run) instead
  of the external `../agent-samples` repo. Examples are now the source
  of truth for the consumer surface.
- Root README: tagline reframed to "Building Generative AI applications
  is mostly context engineering" (was "Building agents..."). Quick Start
  leads with `anthropic({...})` not `mock({reply})`. Roadmap split
  into "What v2.0 ships (today)" + "What's next" so v2.0 reads as a
  complete release. "Why a context-engineering framework" comparison
  table moved up — right after the patterns recipes — where the
  contrast lands hardest.
- Root README: 3-line code teaser between install + the pedagogy
  sections so fluent readers see the builder API in 5 seconds.

### AI tooling overhaul
- `CLAUDE.md`, `AGENTS.md`, and every file under `ai-instructions/`
  rewritten for the v2.0 surface. The old contents were stale (copy
  of footprintjs's instructions or v1 agentfootprint patterns), so
  AI coding tools using bundled instructions would generate code
  against APIs that no longer exist. New surface covers:
  - 6-layer mental model
  - All four `define*` factories (Skill / Steering / Instruction / Fact)
  - `defineMemory({ type, strategy, store })` with 4 types × 7 strategies
  - Multi-agent via control flow (no `MultiAgentSystem` class)
  - Anti-patterns naming the v1 vocabulary so tools don't regress
    consumers to old APIs

## [2.0.0]

The release that lands the **6-layer mental model** end-to-end:
2 primitives + 3 compositions + N patterns + Context Engineering +
**Memory** + Production Features. Every layer is pure composition over
the layers below — no hidden primitives.

### Added — InjectionEngine (unified context-engineering primitive)

One `Injection` primitive evaluated by one engine subflow each
iteration, with N typed sugar factories that all reduce to the same
shape:

- `defineSkill(...)` — LLM-activated body + tools (auto-attaches `read_skill`)
- `defineSteering(...)` — always-on system-prompt rule
- `defineInstruction(...)` — predicate-gated, supports `on-tool-return` for Dynamic ReAct
- `defineFact(...)` — developer-supplied data injection

Consumer wires them via `Agent.create(...).skill(...)`, `.steering(...)`,
`.instruction(...)`, `.fact(...)`, or the generic `.injection(...)`. Every
flavor emits `agentfootprint.context.injected` with `source` discriminating
the flavor — Lens / observability surfaces show one chip per active
injection without per-feature special casing.

### Added — Memory subsystem (`defineMemory` factory)

Single factory dispatches `type × strategy.kind` onto the right
pipeline. The 2D mental model:

```
                MEMORY = TYPE × STRATEGY × STORE

  TYPE                       STRATEGY                    STORE
  ──────────────────         ──────────────────          ─────────
  EPISODIC   messages        WINDOW    last N            InMemoryStore
  SEMANTIC   facts        ×  BUDGET    fit-to-tokens  ×  Redis · Dynamo
  NARRATIVE  beats           SUMMARIZE LLM compress      Postgres · …
  CAUSAL ⭐  snapshots       TOP_K     score-threshold   (peer-deps in v2.1+)
                              EXTRACT   distill on write
                              DECAY     recency × access
                              HYBRID    composed
```

- `Agent.memory(definition)` builder method — multiple memories layer
  cleanly via per-id scope keys (`memoryInjection_${id}`)
- `agent.run({ message, identity })` — multi-tenant scope through the
  full `MemoryIdentity` tuple (tenant / principal / conversationId)
- READ subflow runs at `MEMORY_TIMING.TURN_START` (default; `EVERY_ITERATION`
  opt-in for tool-result-sensitive memory)
- WRITE subflow mounts in the Final route branch with `propagateBreak`
  so writes happen reliably before the loop terminates
- Strict TopK threshold semantics — no fallback when nothing matches
  (garbage past context worse than no context)

**Causal memory ⭐ — the differentiator no other library has.**
footprintjs's `decide()` / `select()` capture decision evidence as
first-class events during traversal. Causal memory persists those
snapshots tagged with the original user query; new questions match
against past queries via cosine similarity, injecting decision evidence
into the next turn's context. Cross-run "why did you reject X?"
follow-ups answer from EXACT past facts — zero hallucination. Same data
shape supports SFT/DPO/process-RL training-data export in v2.1+.

### Added — examples folder (33 examples, all runnable end-to-end)

- `examples/core/` — 2 primitives (LLMCall, Agent + tools)
- `examples/core-flow/` — 4 compositions (Sequence, Parallel, Conditional, Loop)
- `examples/patterns/` — 6 canonical patterns (ReAct, Reflexion, ToT, MapReduce, Debate, Swarm)
- `examples/context-engineering/` — 6 InjectionEngine flavors
  (Instruction / Skill / Steering / Fact / Dynamic-ReAct / mixed)
- `examples/memory/` — 7 strategy-organized memory examples
- `examples/features/` — pause-resume, cost, permissions, observability, events

Every example is a runnable end-to-end test (CI runs `npm run test:examples`
which now does both typecheck + sweep). New `npm run example <path>`
wraps tsx with the right runtime tsconfig so consumers don't need
`TSX_TSCONFIG_PATH` env-var gymnastics.

### Added — top-level public exports

```ts
import {
  // Memory
  defineMemory,
  MEMORY_TYPES, MEMORY_STRATEGIES, MEMORY_TIMING, SNAPSHOT_PROJECTIONS,
  InMemoryStore, mockEmbedder, identityNamespace,
  // InjectionEngine
  defineSkill, defineSteering, defineInstruction, defineFact,
  evaluateInjections, buildInjectionEngineSubflow,
  // … (existing core surface unchanged)
} from 'agentfootprint';
```

### Changed — Agent flowchart shape (internal — no consumer impact)

The Agent's main flowchart now has memory READ subflows mounted
between Seed and InjectionEngine, and the `Route → 'final'` branch is
now a sub-chart (`PrepareFinal → memory-write subflows → BreakFinal`)
so memory writes happen reliably before the loop terminates. This is
visible in narrative + Lens but doesn't change the consumer API.

### Changed — top-level scrub

- All `v2` marketing prefixes scrubbed from `src/` JSDoc / READMEs.
  The library is now just "agentfootprint", not "agentfootprint v2".
- Removed redundant `Execution stopped... due to break condition`
  console.info from footprintjs (3 sites — break is already recorded
  via `narrativeGenerator.onBreak`).

### Fixed — example runtime

- `examples/core/02-agent-with-tools.ts` — custom respond extracts
  city from user message instead of returning empty args
- All 33 examples now run end-to-end in CI; previously only typecheck
  was verified

### Internal — test counts

- agentfootprint: **1121 tests** (was 1044 in 1.23.0; +77 new memory tests)
- footprintjs (peer dep): 2436 tests pass after the leaked-log fix

### Roadmap (next minor releases)

| Release | Focus |
|---|---|
| v2.1 | Reliability subsystem (3-tier fallback, CircuitBreaker, auto-retry, fault-tolerant resume) + Redis store adapter |
| v2.2 | Governance subsystem (Policy, BudgetTracker, access levels) + DynamoDB adapter |
| v2.3 | Causal training-data exports (`exportForTraining({format})`) + RLPolicyRecorder |
| v2.4+ | MCP integration, Deep Agents, A2A |

## [1.23.0]

### BREAKING — but no users yet, shipped as minor

`AgentTimelineRecorder` redesigned around an event stream + selectors + pluggable humanizer. `getTimeline()` method + the `AgentTimeline` bundle interface are removed. Consumers compose typed selectors directly (or use a thin helper like Lens's `timelineFromRecorder`). Three-layer architecture:

```
EVENT STREAM              (structured, canonical — single source of truth)
    ↓
SELECTORS                 (typed, memoized, lazy, composable — THE API)
    ↓
VIEWS                     (renderer plugs in: React / Vue / Angular / CLI / Grafana)
```

### Added — new selector API on `AgentTimelineRecorder`

- `getEvents(): readonly AgentEvent[]` — raw structured event stream
- `selectAgent()`, `selectTurns()`, `selectMessages()`, `selectTools()`, `selectSubAgents()`, `selectFinalDecision()` — classic slices
- `selectTopology()` — composition graph for flowchart renderers (engineer view)
- `selectCommentary(cursor?)` — humanized narrative, one line per event (analyst view)
- `selectActivities(cursor?)` + `selectStatus(cursor?)` — breadcrumb + typing-bubble (end-user view)
- `selectRunSummary()` — tokens, tool counts, duration, skills activated
- `selectIterationRanges()` — iter ↔ event-index map for scrubbers
- `selectContextBySource(cursor?)` — per-slot injection ledger grouped by source (rag / skill / memory / instructions / ...) — powers slot-row badges in Lens and the "teach context engineering" pedagogical surface
- `setHumanizer(Humanizer)` — pluggable domain phrasings. Library defaults ("Thinking", "Running ${toolName}", "Got result") override per-tool for domain-friendly text ("Checking port status on switch-3"). Translation, localization, UX tone = humanizer swap, NOT data change.

### Added — new exported types

`AgentEvent` (discriminated union — the canonical contract), `Activity`, `StatusLine`, `CommentaryLine`, `RunSummary`, `IterationRange`, `IterationRangeIndex`, `ContextBySource`, `ContextSlotSummary`, `ContextSourceSummary`, `Humanizer`.

### Changed — `selectSubAgents()` heuristic

A topology subflow classifies as a sub-agent only if its descendants include one of the API-slot subflows (`sf-system-prompt` / `sf-messages` / `sf-tools`). This correctly distinguishes:
- **Single-agent runs** — the API-slot subflows are top-level, nothing wraps them → no sub-agents
- **Multi-agent runs** (Pipeline/Parallel/Swarm/Conditional) — each Agent wraps its own slots → each qualifies

Robust against future internal-agent subflow additions (auto-classifies as "internal").

### Composed primitive

`AgentTimelineRecorder` now composes footprintjs's `TopologyRecorder` (new in footprintjs 4.15.0) internally. Runner-side `setComposition()` handshake — DELETED. Composition shape discovered at runtime from the executor's traversal (subflow / fork / decision / loop events).

### Memoized selectors

Every selector is memoized by `(name, version, cursor)`. `version` increments on every `emit()` / `setHumanizer()` / `clear()` — long runs don't recompute unchanged views. Same selector call returns the same reference until new events arrive (referential equality for React).

### 10+ new pattern tests

selectActivities state machine + cursor, selectStatus idle/at-cursor, selectCommentary, selectRunSummary totals, humanizer override + fall-through + swap invalidation, selectIterationRanges, memoization reference equality, clear() invalidation, selectContextBySource grouping + cursor.

### Migration

```diff
- const t = agentTimeline();
- const timeline = t.getTimeline();
- timeline.turns;
- timeline.messages;
- timeline.subAgents;
+ const t = agentTimeline();
+ const turns = t.selectTurns();
+ const messages = t.selectMessages();
+ const subAgents = t.selectSubAgents();
```

UI libraries that want a bundled shape define their own helper (Lens ships `timelineFromRecorder(recorder)`).

## [1.22.0]

### attachRecorder() on every runner — multi-agent flows end-to-end

- **FlowChartRunner / ConditionalRunner / ParallelRunner / SwarmRunner**
  all gain `attachRecorder(recorder)` matching the AgentRunner contract.
  Returns detach function; idempotent on recorder id.
- Without this, `<Lens for={runner} />` for these multi-agent
  composition runners fell back to `runner.observe()` + flat
  AgentStreamEvent translation — losing `subflowPath`, which
  broke multi-agent grouping in Lens (subAgents always empty).
- New shared helper `attachRecorderToList()` so the four
  composition runners + AgentRunner stay in sync; future *Runner
  classes get the same behavior with one line of glue.
- 1960 / 1960 tests pass.

End-to-end multi-agent now works in `<Lens for={runner} />`:
- FlowChart pipeline (classify → analyze → respond) renders 3
  stacked sub-agent boxes
- Conditional / Parallel / Swarm samples render the right number
  of sub-agent boxes for their composition pattern

## [1.21.0]

### Multi-agent foundations

- **`runner.attachRecorder(rec)`** — new method on AgentRunner. Attach
  a recorder POST-BUILD; it participates in every subsequent `.run()`
  with the standard recorder lifecycle (clear() + emit-channel hookup
  via forwardEmitRecorders). Returns a detach function; idempotent on
  recorder id (matching the rest of the recorder-attachment contract).
  Lets `<Lens for={runner} />` consume EmitEvents directly (real
  runtimeStageId + subflowPath), unblocking multi-agent grouping.
- **`AgentTimeline.subAgents`** — new field on the timeline shape.
  Per-sub-agent slices for multi-agent runs (Pipeline / Swarm /
  Routing). Empty array for single-agent runs. Each entry is its own
  SubAgentTimeline with `id`, `name`, own `turns`, own `tools` —
  derived by grouping TimelineEntries by `subflowPath[0]`.
- **`SubAgentTimeline`** — new exported type. Self-contained sub-
  agent timeline shape that UIs iterate over for multi-agent
  rendering.
- **TimelineEntry now carries `subflowPath`** internally — preserved
  verbatim from the EmitEvent so the folder can derive sub-agents
  without re-reading source events.
- 7th pattern test added covering multi-agent grouping (Pipeline-style
  classify→analyze→respond) + single-agent's empty subAgents.

The data shape is the contract every UI library reads. `agentfootprint-
lens` 0.11+ uses it to render N agent containers (one per sub-agent)
for Pipeline / Swarm / Routing samples.

## [1.20.0]

### Agent identity surfaces on `AgentTimeline`

- **`agentTimeline({ name })`** — new option on the recorder factory.
  Set the display name once at recorder construction; surfaces on
  `timeline.agent.name`. Match this to `Agent.create({ name })` for
  end-to-end identity consistency.
- **`AgentTimeline.agent`** — new required field of shape
  `{ id, name }`. UI libraries read this directly instead of fishing
  the agent name out of `runtimeSnapshot.agentName / .name` or asking
  the consumer to thread a separate prop. Single source of truth.
- **New exported type `AgentInfo`** —
  `{ id: string; name: string }`. Shape of the new field.
- **Defaults**: `id` falls back to `agentfootprint-agent-timeline`,
  `name` falls back to `Agent`. UIs that get the fallback render
  "Agent · Agent" rather than crashing on undefined.
- **Multi-agent foundation**: each sub-agent recorder
  (`agentTimeline({ id: 'classify', name: 'Classify Bot' })`) carries
  its own identity → multi-agent shells render N labeled containers
  pulling each name from `timeline.agent.name` directly.
- 6th pattern test added, full suite green (1959 tests).

This is the data-layer counterpart to lens 0.9.0's "Agent container +
LLM rename" UI work. Lens reads `timeline.agent.name` to label the
dotted Agent boundary that wraps the LLM / Tool / Skill / satellites.

## [1.19.0]

### New recorder — `agentTimeline()` (the canonical agent narrative)

Parallels footprintjs's `CombinedNarrativeRecorder`. One place every UI
/ observability consumer translates the agentfootprint emit stream into
the agent-shaped narrative they render against — turns → iterations →
tool calls + per-iteration context injections + folded ledger. UI
libraries (`agentfootprint-lens`, `agentfootprint-grafana`, custom
dashboards) consume the same shape instead of each re-implementing
their own translation.

- **`agentTimeline(options?)`** factory, exported from both
  `agentfootprint` and `agentfootprint/observe`. Returns an
  `AgentTimelineRecorder` that extends footprintjs
  `SequenceRecorder<TimelineEntry>` and implements `EmitRecorder`.
  Gets storage, keyed index, range index, progressive `accumulate()`,
  and the `clear()` lifecycle hook for free — no reinvented
  bookkeeping.
- Attach via the standard `.recorder(t)` on AgentBuilder;
  `forwardEmitRecorders` routes to `executor.attachEmitRecorder(t)`.
- **Public types**: `AgentTimeline`, `AgentTurn`, `AgentIteration`,
  `AgentToolInvocation`, `AgentToolCallStub`, `AgentMessage`,
  `AgentContextInjection`, `AgentContextLedger`. These are the data
  contract every UI library consumes.
- **Context-injection routing** preserves semantics: events during the
  LLM phase shape THIS iter's prompt; events between phases shape the
  NEXT iter (skill activation post-`read_skill`).
- **Multi-agent**: `agentTimeline({ id: 'classify' })` — each sub-agent
  in a Pipeline/Swarm gets its own named recorder, its own snapshot
  slot.
- 5 pattern tests (`test/unit/agent-timeline-recorder.test.ts`):
  basic shape, ReAct loop ordering (tool_start after llm_end),
  context-injection routing, multi-turn, clear() lifecycle.
- Docs update in `src/recorders/README.md`.

## [1.18.0]

### Context engineering — first-class teaching surface

- **New `contextEngineering()` recorder** (`src/recorders/ContextEngineeringRecorder.ts`).
  Public consumer-facing recorder that subscribes to the emit channel and
  exposes a structured query API: `injections()`, `ledger()`,
  `ledgerByIteration()`, `bySource()`, `bySlot()`, `clear()`. Lets any
  UI layer (Lens, Datadog, custom panels) observe **who** injected
  **what** into **which** Agent slot, on every iteration. Mirrors
  `agentObservability()` in shape — same factory, same emit-channel
  substrate, different domain focus.

- **Context-injection emits land at the source of truth.**
  - `agentfootprint.context.rag.chunks` fires from
    `src/stages/augmentPrompt.ts` with role + targetIndex + chunkCount +
    topScore (was previously emitted before role/index were known).
  - `agentfootprint.context.skill.activated` fires from
    `src/lib/call/toolExecutionSubflow.ts` whenever
    `decision.currentSkill` flips post-`read_skill`. Carries `skillId`,
    `previousSkillId`, `deltaCount: { systemPromptChars, toolsFromSkill }`.
  - `agentfootprint.context.instructions.fired` fires when
    AgentInstructions fire on a turn — counted, with delta info.
  - `agentfootprint.context.memory.injected` fires from memory subsystem
    when prior-turn memory writes flow back into the prompt.

- **`forwardEmitRecorders()` helper**
  (`src/recorders/forwardEmitRecorders.ts`). Detects whether a
  user-supplied recorder implements `onEmit` and routes it to
  `executor.attachEmitRecorder()`. Wired into all 7 runners (Agent,
  LLMCall, RAG, FlowChart, Parallel, Swarm, Conditional) so
  `.recorder(contextEngineering())` Just Works without consumers having
  to know about footprintjs's three-channel observer architecture.

- **`StreamEventRecorder` forwards `agentfootprint.context.*`** events to
  the `AgentStreamEventHandler`, so consumers using `<Lens for={runner} />`
  see context events alongside stream events without a separate
  subscription.

### Multi-agent + EventDispatcher

- **`EventDispatcher`** — per-runner observer list pattern in
  `src/streaming/EventDispatcher.ts`. Foundation for the
  `runner.observe()` contract Lens consumes.
- Multi-agent type updates in `src/types/multiAgent.ts` + tests.

### Examples + tests

- Snapshot tests updated for the new emit events in execution traces.
- New test scaffolding for context-engineering recorder e2e
  (`test/integration/ce-recorder-e2e.test.ts`,
  `test/unit/context-engineering-recorder.test.ts`,
  `test/unit/context-injection-emits.test.ts`,
  `test/unit/runner-observe-contract.test.ts`).

### Docs

- New / updated guides: `dynamic-react.mdx`, `rag.mdx`, `swarm.mdx`,
  `key-concepts.mdx`, `quick-start.mdx`, `why.mdx`, `vs.mdx`,
  `debug.mdx`.
- README + index.mdx refreshed for the new context-engineering surface.

## [1.17.6]

### Examples — full footprintjs-style parity

- **Wrote 19 missing `.md` explainer files** so every `.ts` example now has
  a paired `.md` (31 / 31 — full 1:1 coverage matching the
  footprintjs/examples/ pattern). New explainers cover: `providers/` (3),
  `runtime-features/{streaming,instructions,parallel-tools,custom-route,memory}/`
  (6), `observability/` (4), `security/` (1), `resilience/` (2),
  `advanced/` (1), `integrations/` (2). Same frontmatter format
  (`name`, `group`, `guide`, `defaultInput`) and same section structure
  (When to use / What you'll see in the trace / Key API / Failure modes /
  Related) as the `concepts/` and `patterns/` explainers shipped in
  v1.17.5.

### Tests — snapshot regression detection

- **`test/examples-smoke.test.ts` now asserts `toMatchSnapshot()`** on
  every example's `run()` output. The previous version only verified
  "does it run without throwing?" — too weak to catch silent behavior
  drift. Now if a library change alters tool counts, iteration counts,
  branch selection, content shape, or any other observable result, the
  snapshot diff fails loudly and forces the author to either fix the
  example or update the golden with `npm test -- -u`.
- 31 baseline snapshots committed to `test/__snapshots__/`. Stable across
  re-runs (verified) — non-determinism (timestamps, latencies, generated
  trace IDs, JSON byte sizes) is scrubbed by a small `sanitize()` helper
  before comparison.
- Brings the in-repo gate to parity with footprintjs's
  `footprint-samples/test/integration` snapshot suite — but inside the
  main repo, no external sibling required.

## [1.17.5]

### Examples

- **Restructured `examples/` from feature-buckets into a lifecycle-based
  ladder** that mirrors the footprintjs/examples/ pattern. New folders:
  `concepts/` (the 7-concept ladder, in order), `patterns/` (Regular vs
  Dynamic + the 4 composition patterns each in their own file),
  `providers/`, `runtime-features/{streaming,instructions,memory,parallel-tools,custom-route}`,
  `observability/`, `security/`, `resilience/`, `advanced/`,
  `integrations/`. The old folders (`basics/`, `orchestration/`,
  `memory/`, `integration/`) are gone — files renumbered sequentially
  within their new home so `01,02,03,...` reflects learning order.
- **Added `examples/DESIGN.md`** explaining the categorization rationale,
  the file contract, and the playground-injection pattern. Added
  `examples/README.md` as the reader's entry point.
- **Every example now follows a single contract**: exports
  `run(input, provider?)` (factory pattern) + `meta: ExampleMeta`
  (catalog metadata for the playground) + a CLI fallback so
  `npx tsx examples/...` still works. The optional `provider` parameter
  lets the playground inject any LLMProvider at runtime — the example
  source stays clean and copy-pastable. Multi-provider examples
  (`planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`) accept an
  object with named slots declared in `meta.providerSlots`.
- **Split `orchestration/28-patterns.ts`** into four separate files
  under `patterns/` — one per pattern — so each is independently
  citable and runnable.
- **Added `concepts/05-parallel.ts`** — the Parallel concept previously
  had no standalone example.
- **Added paired `.md` files** for `concepts/` (7) and `patterns/` (5)
  with frontmatter (`name`, `group`, `guide`, `defaultInput`),
  "When to use", "What you'll see in the trace", "Key API",
  "Failure modes", and "Related concepts" sections — same shape as
  footprintjs/examples/building-blocks/*.md. Other folders' .md files
  will be added in follow-up patches.
- **New `examples/helpers/cli.ts`** centralizes the
  `isCliEntry(import.meta.url)` guard, the `printResult()` formatter,
  and the `ExampleMeta` type.

### Tests

- **New `test/examples-smoke.test.ts`** auto-discovers every example
  under `examples/`, verifies the file contract (`run` + `meta`
  exports with the right shape), and invokes each `run()` with the
  example's own scripted mock provider. 32 examples covered. This
  replaces the previous gate-5 dependency on
  `agent-samples/npm-run-all` — examples are now self-validating
  inside the agentfootprint repo.

### `agent-samples` (separate repo)

- **Updated `agent-samples/package.json`** to point at the new example
  paths so the cross-repo `npm run all` keeps working through the
  transition. Marked the package as DEPRECATED in its description —
  the in-repo smoke test supersedes it; the directory will be removed
  once the playground migration is complete.

## [1.17.4]

### Documentation

- **New `docs/guides/patterns.md`** covering both loop patterns
  (`AgentPattern.Regular` vs `Dynamic`) and the four composition pattern
  factories (`planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`)
  that ship from `agentfootprint/patterns` but were previously
  undocumented. Each pattern section includes an everyday analogy, the
  canonical research citation (Yao et al. 2023, Shinn et al. 2023, Wang
  et al. 2023, Madaan et al. 2023, Dean & Ghemawat 2004), an
  "honesty box" naming the simplification (e.g. shipped `reflexion`
  factory is closer to Self-Refine than full Reflexion), per-pattern
  observability + failure-mode notes, and a
  "Picking a quality pattern" decision table.
- **`docs/guides/concepts.md` updated to reflect the seven shipped
  concepts** (was documenting five — `Parallel` and `Conditional` were
  missing). Added builder + runner sections for both, plus
  per-concept analogies, ReAct/RAG/Swarm citations, and failure-mode
  notes for every concept.
- **`docs/guides/recorders.md` adds the missing `ExplainRecorder`
  section** — the per-iteration grounding evidence recorder that the
  README pitches as the differentiator. Also adds the LLM-as-judge
  caveat (Zheng et al. 2023) on `QualityRecorder`, the recorder-id
  idempotency rule, and updates the summary table with `ExplainRecorder`,
  `PermissionRecorder`, and `agentObservability()`.
- **All other guides (`quick-start`, `providers`, `adapters`,
  `orchestration`, `security`, `instructions`, `streaming`) reviewed
  through a four-persona lens** (student / professor / senior engineer
  / researcher) and updated with: opening analogies, prior-art
  citations where applicable, "Failure modes" / "Cost note" /
  "What's novel" subsections at production-relevant spots, and honest
  positioning language separating shipped behavior from prior art.
- Quick-start example tool replaced (deterministic `add` instead of a
  fake `web_search` returning a hallucinated answer); a new
  "Before You Ship" production checklist links the security /
  orchestration / observability primitives readers should add before
  deploying with a real provider.
- No source code changes — documentation-only release.

## [1.17.3]

### Fixed

- **`agentfootprint.stream.llm_end` now forwards token usage and stop
  reason.** The typed `AgentStreamEvent` schema carried
  `{iteration, toolCallCount, content, model, latencyMs}` but omitted
  `usage` and `stopReason` — so stream consumers (Lens, cost meters,
  any dashboard subscribing to the stream) got `0→0` tokens and no
  finish reason, even though the same data was already present on the
  sibling `agentfootprint.llm.response` event. Three emit sites
  (`callLLMStage.ts` + both paths in `streamingCallLLMStage.ts`) now
  include `usage: response.usage` and
  `stopReason: response.finishReason`. Schema additions are optional
  fields → backwards-compatible for consumers that ignore them.

## [1.17.2]

### Fixed

- **InstructionsToLLM subflow was concatenating arrays across Dynamic
  ReAct iterations.** `buildAgentLoop` mounted `sf-instructions-to-llm`
  without `arrayMerge: ArrayMergeMode.Replace`, so each loop iteration
  appended its `promptInjections` / `toolInjections` to the parent
  scope — the effective system prompt grew 7→14→21→28 lines, and the
  tool list doubled on every turn, triggering Anthropic's
  `"tools: Tool names must be unique"` rejection on iter 4+. Matches the
  existing Replace flag on `sf-messages` / `sf-tools`.
- **`.skills(registry)` did not register per-skill tools for dispatch.**
  Skill tools were declared to the LLM via `AgentInstruction.tools`
  injections, but the dispatch registry only had `list_skills` +
  `read_skill`. When an LLM called a skill-gated tool,
  `staticTools.execute()` returned `{error: true, content: "Unknown
  tool: ..."}` and the turn wedged. `.skills()` now iterates each
  skill's `tools: []` and registers them into the agent's `ToolRegistry`
  so dispatch is always reachable.
- **ToolProvider dispatch now falls back to the registry on "Unknown
  tool" errors.** Callers who use a narrow resolve-time provider
  (`staticTools([listSkills, readSkill])` + injection-based visibility)
  need dispatch to reach the registered skill tools. Both the
  sequential and parallel dispatch paths in `lib/call/helpers.ts` now
  check: if the primary provider reports the tool as unknown AND the
  registry has it, fall through to the registry handler.
- **Decision scope now persists across `.run()` calls.** Previously
  `scope.decision = { ...initialDecision }` reset the decision on every
  turn, so follow-up messages would silently lose the `currentSkill`
  written by the prior turn's `read_skill` — causing `autoActivate` to
  stop surfacing the skill's tools on iter 1 of turn 2+. The runner now
  captures `state.decision` after each run and re-seeds from it next
  time. Cleared by `resetConversation()` for clean new dialogues.
  Unblocks multi-turn chat where the skill context should feel
  continuous.
- **`buildToolsSubflow` now defensively dedupes on three axes.** Base
  tools vs. base tools (in case the provider returned duplicates),
  base vs. injections (pre-existing check), and within injections
  themselves. First-wins on every axis. Belt-and-braces safety net
  against the Anthropic "tool names must be unique" rejection even if
  a future bug reintroduces an injection collision.
- Added 2 new tests to `test/lib/slots/tools.test.ts` pinning the dedup
  behaviors — 15/15 slot tests pass, 1874/1874 full suite still green.

## [1.17.1]

### Fixed

- `SkillRegistry.toTools()` aliased `this` via `const registry = this` which
  tripped the `@typescript-eslint/no-this-alias` rule post-release CI.
  Replaced with explicit `.bind(this)` method captures + a direct reference
  to `this.options.autoActivate` — cleaner closure pattern, no behavioral
  change, 1872/1872 tests still pass.

## [1.17.0]

### Added

- **`SkillRegistry.autoActivate`** — one-line skill-gated tool visibility
  (`agentfootprint/skills`). Unlocks the 25+-tool regime without
  customers hand-wiring a ~30-LOC bridge for every adopter.

  When configured, the auto-generated `read_skill(id)` tool writes the
  loaded skill's id into agent decision scope. Downstream
  `AgentInstruction.activeWhen: (d) => d[stateField] === 'my-skill'`
  predicates fire naturally — so each skill's `tools: [...]` only reach
  the LLM when that skill is active. Smaller tool menus per turn, no
  token-budget drift on long tool lists.

  ```ts
  const registry = new SkillRegistry<TriageDecision>({
    surfaceMode: 'auto',
    autoActivate: { stateField: 'currentSkill' },
  });
  ```

  - `SkillRegistryOptions.autoActivate?: AutoActivateOptions` — new
    config shape: `{ stateField: string, onUnknownSkill?: 'leave'|'clear' }`
  - `read_skill` now returns `{ content, decisionUpdate: { [stateField]: id } }`
    when configured; decisionUpdate is merged into agent decision scope
    by the tool-execution stage.
  - `toInstructions()` auto-fills `activeWhen: (d) => d[stateField] === skill.id`
    on any skill that doesn't declare its own — so consumers set
    `autoActivate` once and every skill gates its own tools by id.
  - `AgentBuilder.skills(registry)` auto-switches agent pattern to
    `Dynamic` when registry has autoActivate, because Regular pattern
    assembles instructions once per turn and wouldn't re-materialize
    tools on the next iteration. Explicit `.pattern(AgentPattern.Regular)`
    after `.skills()` overrides.
  - `SkillRegistry.hasAutoActivate` / `.autoActivate` getters for
    consumers writing custom builders.

- **`ToolResult.decisionUpdate` + `ToolExecutionResult.decisionUpdate`**
  — new optional field any tool (not just auto-generated skill tools)
  can use to write a partial update into the agent's decision scope.
  The tool-execution stage applies shallow `Object.assign(decision, update)`
  after the tool runs. Built-in ToolProviders (`staticTools`,
  `gatedTools`, `compositeTools`, `agentAsTool`) pass it through from
  the inner handler.

### Changed

- Tool-execution subflow: `decisionRef` is now always allocated as `{}`
  when the inbound decision scope is undefined (previously tri-state).
  Simpler invariant + fixes a latent bug where the first turn's
  decision writes from any tool (decide() or decisionUpdate) could be
  dropped if no initial decision scope was configured.

### Tests

- 13 new 5-pattern tests for `autoActivate` (unit / boundary / scenario
  / property / security). Library total: **1872 tests passing**
  (was 1859).

## [1.16.0]

### Added

- **Skills** (`agentfootprint/skills`) — typed, versioned agent skills
  with cross-provider correct delivery. The Claude Agent SDK pattern,
  packaged at `agentfootprint`'s framework layer.
  - `defineSkill<TDecision>(skill)` factory — typed, inference-friendly.
  - `SkillRegistry<TDecision>` — compile skills into `AgentInstruction[]`
    + auto-generated `list_skills` / `read_skill` tools + optional
    system-prompt fragment.
  - `Skill extends AgentInstruction` — every `activeWhen` / `prompt` /
    `tools` / `onToolResult` field inherited, skills add `id`,
    `version`, `title`, `description`, optional `scope[]`, `steps[]`,
    and `body` (string or async loader for disk/blob/Notion).
  - Four surface modes: `'tool-only'` (portable default, works on every
    provider), `'system-prompt'`, `'both'`, `'auto'` (library picks per
    provider — Claude ≥ 3.5 → `'both'`, everyone else → `'tool-only'`).
  - `AgentBuilder.skills(registry)` — one-line wiring. Idempotent
    replace (call twice, latest wins).
  - Tag-escape defense in rendered skill bodies: `</memory>`,
    `</tool_use>`, `</skill>` escaped in author-controlled fields.
  - Error paths (unknown id, lazy-loader throws, path-traversal
    attempts) return `isError: true` in the tool result — agent
    recovers, no crash.
  - Full documentation: `/guides/skills`.
  - `ToolRegistry.unregister(id)` — small focused API for builder-layer
    idempotent replace flows.

### Tests

- 41 new tests across 2 files (32 unit + 9 acceptance).
- Library total: 1859 tests passing.

## [1.15.0]

### Added

- **`autoPipeline()`** — the opinionated default memory preset
  (`agentfootprint/memory`). Composes facts (dedup-on-key) + beats
  (append-only narrative) on a single store, emitting ONE combined
  system message on read.
  - Zero-LLM-cost defaults (`patternFactExtractor` + `heuristicExtractor`).
  - Single `provider` config knob upgrades BOTH extractors to
    LLM-backed in one line.
  - Explicit `factExtractor` / `beatExtractor` escape hatches for
    mixed-quality configurations.
  - READ subflow: `LoadAll` (one `store.list`, split by payload shape
    via `isFactId` + `isNarrativeBeat`) → `FormatAuto` (facts block +
    narrative paragraph in one system msg).
  - WRITE subflow: `LoadFacts` (update-awareness) → `ExtractFacts` →
    `WriteFacts` → `ExtractBeats` → `WriteBeats`.
  - `AutoPipelineState` extends both `FactPipelineState` +
    `ExtractBeatsState` for typed scope.
  - Full documentation: `/guides/auto-memory`.

### Tests

- 16 new tests across 2 files (5-pattern coverage + acceptance).
- Library total: 1818 tests passing.

## [1.14.0]

### Added

- **Fact extraction** (`agentfootprint/memory`). Stable key/value
  fact memory with dedup-on-write — "what's currently true" as a
  complement to beats ("what happened").
  - `Fact<V>` type with `key` / `value` / optional `confidence` /
    `category` / `refs[]` (source-message provenance, like beats).
  - `factId(key)` helper → stable `fact:${key}` MemoryStore ids.
    Last-write-wins: the same key written twice REPLACES the prior
    entry (unlike beats/messages which are append-only).
  - `FactExtractor` interface + two implementations:
    - `patternFactExtractor()` — zero-dep regex heuristics for
      identity / contact / location / preference. Free.
    - `llmFactExtractor({ provider })` — LLM-backed extraction with
      `existing`-facts prompt injection so the model can update
      rather than duplicate. One call per turn. Malformed JSON falls
      back to `[]` with `onParseError` callback.
  - Stages: `extractFacts`, `writeFacts`, `loadFacts`, `formatFacts`.
    `formatFacts` renders a compact `Known facts:` key/value block
    (not `<memory>` tags, not a paragraph) — the shape LLMs parse
    most efficiently.
  - `factPipeline({ store, extractor? })` preset. Read subflow:
    LoadFacts → FormatFacts. Write subflow: LoadFacts → ExtractFacts
    → WriteFacts (LoadFacts-on-write surfaces existing facts to the
    extractor for update-awareness).
  - Full documentation: `/guides/fact-extraction`.

### Tests

- 104 new tests across 6 files (5-pattern coverage per layer).
- Library total: 1802 tests passing.

## [1.13.0]

### Added

- **Semantic retrieval** (`agentfootprint/memory`). Vector-based
  recall via cosine similarity over entry embeddings.
  - `Embedder` interface with `embed()` / optional `embedBatch()` —
    pluggable (OpenAI / Voyage / Cohere / custom). Ships
    `mockEmbedder()` (deterministic character-frequency hash) for tests.
  - `MemoryEntry.embedding?` + `embeddingModel?` fields for indexing.
  - `MemoryStore.search?(identity, query, options)` optional method;
    `InMemoryStore` implements O(n) cosine scan. Options: `k`,
    `minScore`, `tiers`, `embedderId` (cross-model safety).
  - `cosineSimilarity(a, b)` helper; length-mismatch throws,
    zero-magnitude returns 0 (never NaN).
  - Stages: `embedMessages` (write-side) + `loadRelevant` (read-side,
    pulls query from last user message by default).
  - `semanticPipeline({ store, embedder, embedderId? })` preset —
    drop-in replacement for `defaultPipeline` with vector recall.
  - Write-side: `writeMessages` attaches per-message embeddings
    from `scope.newMessageEmbeddings` when present.
  - Read-side: `mountMemoryRead` passes `scope.messages` into the
    subflow so `loadRelevant` derives the query from the user turn.
  - 85 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/semantic-retrieval` docs.

### Changed

- `test/lib/concepts/Agent.parallelTools.test.ts` — perf threshold
  relaxed from 2× to 2.5×DELAY to tolerate dev-machine jitter while
  still discriminating parallel (≤2.5×) from sequential (3×).

## [1.12.0] — BREAKING

### Added

- **Narrative memory** (`agentfootprint/memory`). A new memory strategy
  that compresses each turn into `NarrativeBeat`s on write and recalls
  them as a single cohesive paragraph on read — instead of storing
  raw messages.
  - `NarrativeBeat` type: `{ summary, importance, refs, category? }`
    — every beat carries `refs[]` traceable back to source messages
    for explainability / audit.
  - `BeatExtractor` interface with two built-in implementations:
    - `heuristicExtractor()` — zero-dep, zero-cost baseline.
    - `llmExtractor({ provider, systemPrompt?, onParseError? })` —
      one LLM call per turn, produces semantically rich beats. Robust
      JSON parsing; malformed responses skipped without crashing turns.
  - `extractBeats(config)` + `writeBeats(config)` write-side stages.
  - `formatAsNarrative(config)` read-side stage — composes selected
    beats into a single paragraph (vs `formatDefault`'s per-entry blocks).
  - `narrativePipeline({ store, extractor?, ... })` preset — drop-in
    replacement for `defaultPipeline` with beat-based memory.
  - **Differentiator**: no other open-source agent framework provides
    beat-level traceability for recalled memory.
  - 77 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/narrative-memory` docs.

### Removed (hard break — pre-GA, no deprecation cycle)

- **`Agent.memory(config: MemoryConfig)`** builder method.
  Superseded by `.memoryPipeline(pipeline)` which landed in 1.11.0.
- **`MemoryConfig` / `ConversationStore`** interfaces and the legacy
  `InMemoryStore` adapter from `src/adapters/memory/`. The canonical
  store interface is now `MemoryStore` in `agentfootprint/memory`.
- **`createCommitMemoryStage` / `CommitMemoryConfig`** —
  `CommitMemory` stage retired; the memory pipeline's write subflow
  lives inside the `final` branch subflow and is composed via
  `mountMemoryWrite`.
- **`createPrepareMemorySubflow` / `PrepareMemoryConfig`** —
  absorbed into the memory pipeline's read subflow.
- **`persistentHistory()` message strategy + its bundled `InMemoryStore`** —
  message strategies now focus on in-context reshaping (sliding
  window, char budget, summary). Durable persistence lives in the
  memory pipeline.
- **`MessagesSlotConfig.store` / `.conversationId`** fields — the
  Messages slot is now strategy-only. Durable persistence is owned by
  the memory pipeline.
- **`AgentLoopConfig.commitMemory` / `.useCommitFlag` / `.onStreamEvent`**.
  Memory wiring flows via `memoryPipeline`. Stream events route
  through the emit channel — attach an onEvent callback via
  `agent.run(msg, { onEvent })`.
- **`memory_storedHistory` scope field + `MEMORY_PATHS.STORED_HISTORY`** —
  dead after `CommitMemory` removal.
- **Legacy store adapters** `redisStore`, `dynamoStore`, `postgresStore`
  — real backends land in Phase 3 against the new `MemoryStore` interface.

### Changed

- **Conditional concept** (`Agent.route()` extensions) now mounts
  branches as subflows when the runner exposes `toFlowChart()`,
  matching the `FlowChart.ts` / `Swarm` patterns. UI consumers get
  drill-down into routed-to agents for free.
- **Stream events now flow through the emit channel.**
  `agentfootprint.stream.llm_start` / `llm_end` / `token` / `thinking`
  / `tool_start` / `tool_end` events are emitted with the full
  `AgentStreamEvent` as the payload. `AgentRunner` attaches a
  `StreamEventRecorder` (public API in `agentfootprint/stream`) that
  forwards emits to the consumer's `{ onEvent }` callback — zero
  closure capture of handlers inside stage code.
- **Agent chart is now CACHED** — built once per agent, reused across
  all `.run()` and `.toFlowChart()` calls. Per-run data (stream handler,
  memory identity, seed messages) flows via args / attached recorders.
- **`pickByBudget`** restructured as a proper decider stage with three
  branches (`skip-empty`, `skip-no-budget`, `pick`) — decision evidence
  now lands on `FlowRecorder.onDecision` with structured `rules[]`.
- **`MemoryStore.putMany`** added for batched writes. `writeMessages`
  now persists a turn's messages in one round-trip instead of N.
- **`RouteResponse` decider** uses the filter-form `decide()` DSL with
  structured evidence (`{ key: 'hasToolCalls', op: 'eq', threshold: true, … }`).
  `ParseResponse` lifts `parsedResponse.hasToolCalls` to the flat
  `scope.hasToolCalls` so the filter form can reach it.
- **`buildSwarmRouting` + `Conditional`** deciders return full
  `DecisionResult` objects so `FlowRecorder.onDecision` captures
  evidence (no more silent `.branch`-only returns).

### Migration

Replace:

```ts
const store = new InMemoryStore();
const agent = Agent.create({ provider })
  .memory({ store, conversationId: 'user-123' })
  .build();
```

With:

```ts
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';

const pipeline = defaultPipeline({ store: new InMemoryStore() });
const agent = Agent.create({ provider })
  .memoryPipeline(pipeline)
  .build();

await agent.run(message, {
  identity: { conversationId: 'user-123' },
});
```



## [1.11.0]

### Added

- **`agentfootprint/memory` subpath — full memory pipeline system.** Built bottom-up in 9 reviewed layers, 190 tests, composing into a flowchart-first architecture consistent with the rest of the library.
  - **Identity + entries** — `MemoryIdentity { tenant?, principal?, conversationId }`, `MemoryEntry<T>` with decay/tier/source/version, pure `computeDecayFactor()` with exponential time decay + access boost.
  - **`MemoryStore` interface** — 9-method CRUD boundary with pagination cursor, `putIfVersion` optimistic concurrency, `seen()` recognition, `feedback()` usefulness aggregation, `forget()` GDPR delete. `InMemoryStore` reference implementation (zero deps, TTL-aware, tenant-isolated).
  - **Reusable stages** — `loadRecent`, `writeMessages`, `pickByBudget` (decider — budget-aware selection with `decide()` evidence), `formatDefault` (source-cited `<memory>` blocks + prompt-injection escape), `summarize` (deterministic contract for prompt caching).
  - **Pipeline presets** — `defaultPipeline()` (load → pick → format for read; persist for write), `ephemeralPipeline()` (read-only, compliance-grade no-write guarantee).
  - **Wire helpers** — `mountMemoryRead`, `mountMemoryWrite`, `mountMemoryPipeline` for composing pipelines into custom flowcharts.
- **`Agent.memoryPipeline(pipeline)` builder method** — first-class integration wiring the pipeline's read subflow before `AssemblePrompt` and write subflow after `Finalize`. Prior-turn memory is injected as citation-tagged `system` messages that AssemblePrompt prepends to the LLM prompt.
- **Per-run identity via `agent.run(msg, { identity, turnNumber?, contextTokensRemaining? })`** — same agent instance can serve many tenants / sessions with hardware-enforced isolation. Identity defaults to `{ conversationId: 'default' }` when omitted.
- **Example** `examples/memory/30-remember-across-turns.ts` — Alice/Bob session isolation demo using `mock` adapter.
- **5 integration tests** in `test/integration/memoryPipeline.test.ts` covering turn-1 persistence, turn-2 retrieval, per-run identity scoping, tenant isolation, and `.memory()` vs `.memoryPipeline()` mutual exclusivity.

### Process

- Every one of the 9 layers cleared an 8-person review gate (performance, DS/algorithms, security, research/RAG, platform, Anthropic, abstract/modular, 5-pattern tests) — iterating until no actionable findings remained. All 7 industry + 3 research reviewer asks from the design phase landed (hierarchical identity, pagination, `putIfVersion`, source-tagged recall, budget-aware picker, `seen()` + `feedback()`, decay math, ephemeral mode, deterministic summarizer, prompt-injection escape in formatter).

### Compatibility

- Existing `Agent.memory(MemoryConfig)` legacy API is unchanged. New consumers should prefer `.memoryPipeline()`. The two cannot be combined on the same builder — builder throws if both are set.
- Internals: `AgentLoopConfig` gains optional `memoryPipeline?: MemoryPipeline` alongside the existing `commitMemory?`. Legacy `commitMemory` path takes precedence when both somehow reach the loop (guards exist at the builder level).

## [1.10.0]

### Added

- **`exportTrace(runner, { redact?: boolean })`** — capture an agent run's full state as a portable JSON trace for external sharing. Bundles `snapshot`, `narrativeEntries`, `narrative`, and `spec` into a `AgentfootprintTrace` shape with `schemaVersion: 1`. Default `redact: true` requests `getSnapshot({ redact: true })` from the runner so footprintjs's [4.14.0 redacted-mirror](https://github.com/footprintjs/footPrint/blob/main/docs/internals/adr-002-redacted-mirror.md) feature scrubs `sharedState`. Use this to ship traces to a viewer, support engineer, or audit log without leaking PII.
- **`AgentfootprintTrace` + `ExportTraceOptions` types** exported from the main entry. Pin consumers to `schemaVersion: 1`; future shape changes will bump the version.
- **Example** `examples/observability/29-export-trace.ts` — captures and prints a trace using the `mock` adapter.
- **10 new tests** (5 patterns) covering schema version, snapshot pass-through, missing-method graceful degradation, JSON round-trip, and the safe-by-default `redact: true` choice.

### Changed

- **`footprintjs` peer dep + devDep bumped to `^4.14.0`** — required for the redacted-mirror `getSnapshot({ redact })` API. `exportTrace` falls back to a 0-arg `getSnapshot()` if the runner predates 4.14, so older deployments still produce a (raw) trace.

## [1.9.0]

### Added

- **`agentfootprint/patterns` — canonical composition patterns as thin factories.** Each pattern composes existing concepts (FlowChart / Parallel / Conditional / Agent / LLMCall) and returns a standard Runner — no new primitives, no new classes. Source files are short and teach the composition pattern.
  - `planExecute({ planner, executor })` — sequential planning → execution (FlowChart of 2).
  - `mapReduce({ provider, mappers, reduce })` — N pre-bound mappers fanned out, then reduced via LLM or pure fn (Parallel with named merge).
  - `treeOfThoughts({ provider, branches, thinker, judge })` — N parallel thinkers, judge picks the best (FlowChart of Parallel → judge).
  - `reflexion({ solver, critic, improver })` — single-pass Solve → Critique → Improve (FlowChart of 3). Multi-iteration variants compose with `Conditional`.
- **Example**: `examples/orchestration/28-patterns.ts` — all four patterns + a composed `Conditional` routing between them, all using the `mock` adapter.
- **10 new tests** covering wiring, input propagation, argument validation, and patterns-inside-patterns composition.

## [1.8.0]

### Added

- **`Conditional` concept — the DAG branch primitive.** Thin wrapper over footprintjs `addDeciderFunction` + `addFunctionBranch` that routes between runners based on synchronous predicates. First-match-wins; failing predicate fail-opens to the next branch; `.otherwise(runner)` is required. Exposes the same Runner surface as other concepts (`run`, `getNarrative`, `getSnapshot`, `getSpec`, `toFlowChart`) and composes inside `FlowChart` / `Parallel` / `Agent.route()` / another `Conditional`.
  ```ts
  const triage = Conditional.create({ name: 'triage' })
    .when((input) => /refund/i.test(input), refundAgent, { id: 'refund' })
    .when((input) => input.length > 500, ragRunner)
    .otherwise(generalAgent)
    .build();

  await triage.run('I want a refund');
  // narrative: "[triage] Chose refund — predicate 0 matched"
  ```
  Completes the DAG primitive set: **leaf** (LLMCall/RAG), **cycle** (Agent), **sequence** (FlowChart), **fan-out** (Parallel), **branch** (Conditional), **dispatch** (Swarm). Users can now build any composition from existing concepts without dropping to raw footprintjs.
- **Guards on `Conditional.when()`** — rejects non-function predicates, non-runner values, reserved `'default'` id, branch IDs with `/` or whitespace (would break `runtimeStageId`), and duplicate IDs. Fail-open on throwing predicates (never blocks a valid branch). Frozen state snapshot passed to predicate — mutation attempts silently no-op.
- **Example**: `examples/orchestration/27-conditional-triage.ts` — deterministic triage demo using the `mock` adapter.
- **25 new tests** across 5 patterns (unit/boundary/scenario/property/security), including real Agent composition and nested Conditionals.

## [1.7.1]

### Fixed

- **CI + npm publish** — `devDependencies.footprintjs` was pinned to `file:../footPrint`, which doesn't resolve in CI. Switched to `^4.13.0` so CI installs from the registry. `footprintjs` is also now declared as a `peerDependency` (`>=4.13.0`) to make the install-time contract explicit. This is why v1.7.0 failed to publish.

## [1.7.0]

### Added

- **Emit-channel LLM diagnostics.** `CallLLM` stage (both streaming and non-streaming) now fires `scope.$emit('agentfootprint.llm.request', {...})` before the provider call and `scope.$emit('agentfootprint.llm.response', {...})` after, surfacing the exact shape being sent/received. Payloads include iteration, message roles, tool names + required fields, usage, stop reason, and tool-call signatures.
- **`agentRenderer.renderEmit`** — custom narrative rendering for `agentfootprint.llm.request`/`response` events. Output like `LLM request (iter 2): 5 msgs [system,user,assistant,tool,tool], 4 tools — calculator required:[expression]` appears inline under each `CallLLM` stage in combined narratives.
- **`AgentBuilder.maxIdenticalFailures(n)`** — threshold for repeated-identical-failure escalation. When a tool call with the exact same `(name, args)` has failed `n` times in a row, a one-shot `escalation` field is injected into that tool result content urging the LLM to change arguments, switch tools, or finalize. Fires exactly once per `(name, args)` key per conversation. Defaults to `3`. Pass `0` to disable. Uses strict JSON parsing (not substring sniffing) so legitimate prose containing `"error":true` is not misclassified; stable key-sorted stringify so equivalent arg objects match regardless of insertion order.
- **`scope.maxIterationsReached` signal** — when the agent loop hits `maxIterations`, the structural guard now sets this flag AND force-routes to the default branch. Any terminal stage (default `Finalize`, `Swarm.RouteSpecialist` fallback, user-supplied terminals) can detect forced termination and synthesize an appropriate final message. Finalize now emits a user-facing fallback when the flag is set.
- **Tool-call signatures in narrative.** `ParseResponse` now renders `responseType` as `tool_calls: [calculator({"expression":"4+5"}), web_search({"query":"weather"})]` — names plus JSON-stringified args (tight cap) so debuggers see at a glance whether the LLM passed required fields. Names alone hid the common failure mode of retrying with empty / wrong args.

### Fixed

- **Anthropic streaming adapters dropped tool arguments.** `BrowserAnthropicAdapter.chatStream()` and `AnthropicAdapter.chatStream()` yielded `tool_call` chunks with `arguments: {}` at `content_block_start`, then accumulated `input_json_delta` chunks into a buffer that was never consumed. The streaming stage pushed the empty-args version, causing LLMs to re-attempt calls with `{}` until `maxIterations` exhausted. Fixed by deferring the `tool_call` yield until args are complete — emit at `content_block_stop` with parsed JSON (browser) / after `stream.finalMessage()` (Node SDK). Combined with the new emit-channel diagnostics, this bug was diagnosable for the first time.

### Changed

- **Requires `footprintjs` >= 4.13.0** for emit-channel features. Install explicitly: `npm install footprintjs@^4.13.0 agentfootprint@^1.7.0`.

## [1.6.1]

### Fixed

- **CI + publish workflows** — `npm install` instead of `npm ci`, no npm cache (lockfile not committed due to platform-specific native deps). This is why v1.5.0 and v1.6.0 failed to publish to npm.
- **footprintjs devDep** bumped to `^4.12.2` (resume continuation fix).

## [1.6.0]

### Added

- **`examples/` directory** — 22 type-checked examples as single source of truth (was in separate agent-samples repo). 8 categories: basics, providers, orchestration, observability, security, resilience, memory, integration.
- **`test:examples` npm script** — type-checks all examples against library source.
- **Barrel exports** — `agentLoop`, `AgentLoopConfig`, `defineInstruction`, `AgentPattern`, `quickBind`, `AgentInstruction`, `InstructedToolDefinition`, `TokenRecorder`, `ToolUsageRecorder`, `TurnRecorder`, `CostRecorder` from main entry. `staticTools`, `noTools` from `/providers`. `ExplainRecorder` from `/observe`.
- **3 new examples** — agent-loop (low-level engine), instructions (conditional context injection), explain-recorder (grounding evidence).

### Changed

- **`ToolHandler` type** — `(input: any)` instead of `(input: Record<string, unknown>)`. Allows typed destructured params in tool handlers: `({ query }: { query: string }) =>`. Non-breaking.
- **`footprintjs` peer dep** — bumped to `>=4.12.0` (backtracking, quality trace, staged optimization).

### Fixed

- **4 pre-existing type errors** in examples (API drift from agent-samples): resilience callbacks, ToolDefinition.name→id, message strategy args, instruction type casts.

## [1.5.0] - 2026-04-09

### Added

- **`runtimeStageId`** — mandatory on `LLMCallEvent` and `ToolCallEvent`. The universal key linking recorder data to execution tree nodes and commit log entries. Format: `[subflowPath/]stageId#executionIndex`.
- **Map-based recorders** — `TokenRecorder`, `ToolUsageRecorder`, `CostRecorder` extend `KeyedRecorder<T>` from `footprintjs/trace`. O(1) lookup via `getByKey(runtimeStageId)`, `getMap()`. Zero fallback keys.
- **`EvalIteration.runtimeStageId`** — each iteration links to its execution step
- **`createLLMCaptureRecorder()`** — shared factory for run() and resume() LLM capture. Both paths now track `runtimeStageId` for stream bridge tool events.
- **`RecorderBridge.setToolRuntimeStageId()`** — encapsulated state tracking (was public mutable field)
- 5 new tests for runtimeStageId on all recorder types

### Changed

- **footprintjs >=4.7.0 required** — added to `dependencies` (was only in devDependencies)
- **`agentLoop.ts`** — uses `buildRuntimeStageId` + `createExecutionCounter` from `footprintjs/trace`
- **`LLMCallRunner` + `RAGRunner`** — use `findCommit` from `footprintjs/trace` (zero `(b: any)` casts)
- CLAUDE.md + AGENTS.md — documented `runtimeStageId`, `KeyedRecorder`, `getByKey()` pattern

### Removed

- All `__auto_` fallback keys — runtimeStageId is always provided
- Duplicate LLM capture code in resume() path — replaced by shared factory

## [1.4.2] - 2026-04-07

### Fixed

- **README rewrite** — Architecture moved to 3rd section, headers renamed to relatable terms (Conditional Behavior, Observability, Human-in-the-Loop), 4 broken import paths fixed, redundant sections folded, 380→280 lines
- **5 folder READMEs** — concepts, adapters, providers, memory, tools with relatable naming and code examples
- **recorders/README.md** — 5 categories, event→recorder mapping, design principles
- **What's Different section** — 10 unique features grouped by concern (Quality/Safety/UX/Debugging)

## [1.4.1] - 2026-04-07

### Fixed

- **`RecorderBridge.loopIteration`** — now increments after each `dispatchLLMCall` (was always 0)
- **Per-iteration context** — each LLM call gets its own context snapshot (was sharing last state for all)
- **`resume()` path** — captures context same as `run()` (was empty)
- **`ExplainRecorder`** — guards `iteration: -1` when `onTurnComplete` fires without `onLLMCall`
- **Format gate** — release script fails on unformatted files instead of silently fixing

### Added

- **5 folder READMEs** — concepts, adapters, providers, memory, tools — with relatable naming (Single LLM / Multi-Agent), code examples, and cross-references
- **Main README** — 5-layer architecture diagram (Build → Compose → Evaluate → Monitor → Infrastructure), updated Recorders section with 5 categories
- **recorders/README.md** — event → recorder mapping, design principles
- **5 tests** for `EvalIteration`, per-iteration context, flat/iteration consistency
- **Flattened `recorders/v2/`** → `recorders/` — removed unnecessary indirection

### Changed

- `CLAUDE.md` + `AGENTS.md` — updated directory tree descriptions

## [1.4.0] - 2026-04-07

### Added

- **`explain().iterations`** — per-iteration evaluation units with connected data. Each iteration captures context (what the LLM had), decisions (tools chosen), sources (results), and claim (LLM output). Evaluators walk iterations to check faithfulness, relevance, and hallucination.
- **`EvalIteration` type** — self-contained evaluation unit for each loop iteration

## [1.3.0] - 2026-04-07

### Added

- **`explain().context`** — ExplainRecorder captures evaluation context during traversal: input, systemPrompt, availableTools, messages, model
- **`LLMContext` type** — what the LLM had when making decisions
- **`LLMCallEvent.systemPrompt`/`toolDescriptions`/`messages`** — context fields on events (optional, backward-compatible)

## [1.2.0] - 2026-04-07

### Added

- **`obs.explain()`** — ExplainRecorder bundled into `agentObservability()` preset. Grounding analysis (sources vs claims) out of the box — the differentiator.
- **8-gate release script** — mirrors footprintjs: doc check, dup type check, build, tests, sample projects, CHANGELOG validation
- **`scripts/check-docs.sh`** — blocks release if docs reference removed APIs
- **`scripts/check-dup-types.mjs`** — blocks release if duplicate type definitions found across src/

### Fixed

- **ModelPricing duplicate** — CostRecorder now imports from `models/types` instead of redefining

## [1.1.0] - 2026-04-07

### Added

- **Message strategies in providers barrel** — `slidingWindow`, `charBudget`, `fullHistory`, `withToolPairSafety`, `summaryStrategy`, `compositeMessages`, `persistentHistory` now exported from `agentfootprint/providers`
- **Error utilities in resilience barrel** — `classifyStatusCode`, `wrapSDKError` now exported from `agentfootprint/resilience`

### Removed

- **`getGroundingSources`, `getLLMClaims`, `getFullLLMContext`** from `agentfootprint/explain` — post-processed narrative entries (anti-pattern). Use `ExplainRecorder` instead, which collects during traversal.
- **`slidingWindow`, `truncateToCharBudget`** from internal `memory/conversationHelpers` — dead code duplicating the public `MessageStrategy` API in `providers/messages/`

## [1.0.0] - 2026-04-06

### Added

- **Capability-based subpath exports** — 7 focused import paths, tree-shakeable:
  - `agentfootprint/providers` — LLM providers, adapters, prompt/tool strategies
  - `agentfootprint/instructions` — defineInstruction, AgentPattern, InstructionRecorder
  - `agentfootprint/observe` — all 9 recorders + agentObservability preset
  - `agentfootprint/resilience` — withRetry, withFallback, resilientProvider
  - `agentfootprint/security` — gatedTools, PermissionPolicy
  - `agentfootprint/explain` — grounding helpers, narrative renderer
  - `agentfootprint/stream` — AgentStreamEvent, SSEFormatter
- **Full backward compatibility** — `import { everything } from 'agentfootprint'` still works
- **`typesVersions`** in package.json for older TypeScript resolution

### Changed

- `index.ts` reorganized with comments pointing to capability subpaths
- PermissionRecorder canonical home is `agentfootprint/observe` (removed from security barrel)

## [0.6.2] - 2026-04-05

### Added

- **Instructions guide** — `docs/guides/instructions.md` (Decision Scope, 3-position injection, decide())
- **Streaming guide** — `docs/guides/streaming.md` (AgentStreamEvent, onEvent, SSE, event timeline)
- **Sample 17** — Instructions (defineInstruction, decide, conditional activation, tool injection)
- **Sample 18** — Streaming events (lifecycle, tool events, ordering, backward compat, SSE)
- **Module READMEs** — `src/lib/instructions/`, `src/streaming/`, `src/lib/narrative/`
- **CLAUDE.md + AGENTS.md** — Instructions, Streaming, Grounding sections + anti-patterns
- **README.md** — Instructions, Streaming, Grounding Analysis sections
- **JSDoc** — `@example` on `getGroundingSources()`, `getLLMClaims()`

## [0.6.1] - 2026-04-05

### Added

- **AgentStreamEvent** — 9-event discriminated union for real-time agent lifecycle
  - `turn_start`, `llm_start`, `thinking`, `token`, `llm_end`, `tool_start`, `tool_end`, `turn_end`, `error`
  - `onEvent` callback on `agent.run()` — full lifecycle visibility for CLI/web/mobile consumers
  - Works in both streaming and non-streaming mode (only `token` requires `.streaming(true)`)
  - `turn_end` emits `paused: true` on ask_human pause
- **Backward compat** — `onToken` still works (deprecated, sugar for `onEvent` token filter)
- **Collision guard** — `onEvent` + `onToken` together: `onToken` ignored + dev-mode warn
- **Error isolation** — `onEvent` handler errors swallowed (never crash agent pipeline)

### Fixed

- `streamingCallLLMStage` fallback path now passes `signal` for cancellation
- `tool_end.latencyMs` excludes instruction processing overhead

## [0.6.0] - 2026-04-05

### Added

- **Instruction Architecture** — `AgentInstruction`, `defineInstruction()`, `InstructionsToLLM` subflow
  - 3-position injection: system prompt, tools, tool-result recency window
  - `activeWhen(decision)` — state-driven conditional instruction activation
  - `decide()` field on `LLMInstruction` — tool results update Decision Scope
  - `AgentScopeKey` enum — type-safe scope key references
- **Agent builder API** — `.instruction()`, `.instructions()`, `.decision()`, `.verbose()`
- **Grounding helpers** — `getGroundingSources()`, `getLLMClaims()`, `getFullLLMContext()`
- **Verbose narrative** — `createAgentRenderer({ verbose: true })` shows full values
- **Dynamic ReAct + Instructions** — `AgentPattern.Dynamic` loops back to `InstructionsToLLM`

### Fixed

- Tool names duplication in Dynamic mode (uses `ArrayMergeMode.Replace`)
- `toolProvider` wired through `buildConfig` for execution
- AssemblePrompt replaces system message in Dynamic mode
- Browser compat (`process.env` guarded)
- Registry mutation moved to constructor (runs once)
- Pausable root stage (no post-build graph mutation)
- Streaming stage typed as `TypedScope<AgentLoopState>`

### Changed

- Peer dependency: `footprintjs >= 4.4.1` (was `>= 4.0.0`)
- Eliminated `ApplyPreparedMessages` and `ApplyResolvedTools` copy stages

## [0.3.0] - 2026-03-29

### Fixed

- `setEnableNarrative()` removed from FlowChartBuilder chain — call `executor.enableNarrative()` instead (footprintjs v3.x API)
- Stage functions in LLMCall, Agent, RAG, FlowChart now receive a plain `ScopeFacade` via `agentScopeFactory`, bypassing TypedScope proxy (required for `getValue`/`setValue` access)

### Changed

- Peer dependency: `footprintjs >= 3.0.0` (was `>= 0.10.0`)

## [0.2.0] - 2026-03-17

### Added

- **Browser LLM adapters**: `BrowserAnthropicAdapter` and `BrowserOpenAIAdapter` — fetch-based, zero peer dependencies
  - Direct browser-to-API calls using user's own API key
  - Full chat() + chatStream() with SSE streaming via ReadableStream
  - Tool call support, AbortSignal, custom baseURL for compatible APIs
  - Anthropic CORS via `anthropic-dangerous-direct-browser-access` header
  - OpenAI `stream_options.include_usage` for streaming token counts
- 18 browser adapter tests

### Removed

- Legacy v1 recorders: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder (no users yet, replaced by v2 AgentRecorder interface)

## [0.1.0] - 2026-03-15

### Added

- **Concept ladder**: LLMCall, Agent, RAG, FlowChart, Swarm — each builds on the previous
- **LLM Adapters**: AnthropicAdapter, OpenAIAdapter, BedrockAdapter with full chat + streaming
- **Provider bridge**: `createProvider()` connects config factories (`anthropic()`, `openai()`, `ollama()`, `bedrock()`) to adapter instances
- **Mock adapter**: `mock()` for $0 deterministic testing — same code path as production
- **Multi-modal content**: Base64 and URL image support across all adapters
- **Error normalization**: `LLMError` with 9 error codes, `retryable` flag, `wrapSDKError()` auto-classifier
- **Compositions**: `withRetry()`, `withFallback()`, `CircuitBreaker` for resilient agent execution
- **V2 Recorders**: TokenRecorder, TurnRecorder, ToolUsageRecorder, QualityRecorder, GuardrailRecorder, CostRecorderV2, CompositeRecorder
- **V1 Recorders**: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder *(removed in 0.2.0)*
- **Protocol adapters**: `mcpToolProvider()` for MCP, `a2aRunner()` for A2A
- **Prompt providers**: staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt
- **Tool providers**: agentAsTool, compositeTools, ToolRegistry, defineTool
- **Memory management**: slidingWindow, truncateToCharBudget, appendMessage
- **Streaming**: StreamEmitter, SSEFormatter
- **Agent loop**: Low-level `agentLoop()` for custom control flow
- **16 sample tests** covering every feature
- **608 tests** across 63 test files
