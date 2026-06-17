# Skill Graph + Explainable Routing — Spec & Usage

**Audience:** a developer *or a coding agent* adopting these features (e.g. on neo-agentfootprint). This is the single ready-to-reference doc: what exists, how to use it (with code), where it lives, and what is still a gated proposal.

> ## ⚠️ Status legend — read this first
> - ✅ **SHIPPED** — on npm, importable, usable today.
> - 🔶 **PROPOSED** — designed + reviewed, **gated, NOT implemented.** Do **not** `import` these symbols; they do not exist yet. They are documented so the design can be understood + reviewed.
>
> **Quick map:** Part 1 (the UI you *see* it in) and Part 2 (the LLM-free *why* scoring) are ✅ SHIPPED. Part 3 (`skillGraph()` declarative routing) is 🔶 PROPOSED — full design in [`skill-graph.md`](./skill-graph.md).

---

## Part 1 — agentThinkingUI: *see* what the agent did ✅ SHIPPED (`agentthinkingui` ≥ 0.17.0)

A trace recorded by agentfootprint's `agentThinkingTrace` renders as a scrubbable scene. Two tool-menu layouts; rack mode adds the "Why this tool?" panel.

```tsx
import { AgentThinkingUI } from 'agentthinkingui';
import 'agentthinkingui/styles.css';
import { agentThinkingTrace } from 'agentfootprint/observe';

// 1. record a run
const att = agentThinkingTrace({ agent: 'Neo', model });
const agent = Agent.create({ provider, model }).recorder(att).tool(...).build();
await agent.run({ message });

// 2. render it
<AgentThinkingUI
  trace={att.getTrace()}
  toolMenu="rack"                       // "card" (default) | "rack"
  labels={{ agent: 'Neo Agent' }}        // renames the brain (default "LLM as Human Brain")
  onExplain={explainToolChoice}          // optional — see below
/>
```

| Prop | Type | What it does |
|---|---|---|
| `toolMenu` | `'card' \| 'rack'` | `card`: one tool pops out + a "saw N" caption. `rack`: a vertical rack of every tool the model saw (picked lit, arrow on it, "+N more" cap), with the **Why this tool?** panel. |
| `labels` | `{ agent?, toolbox? }` | rename the brain / toolbox. |
| `onExplain` | `(ctx) => Promise<string \| { reason, score }>` | wires the Why-panel's **"✨ Explain (live)"** button to *your* LLM. The library makes no LLM calls itself. |

**Rack mode → the Why panel** (click-only, auto-scrolls into view): clicking a rack tool (or the **"🔍 Why this tool?"** button below the rack) shows the tools ranked by relevance, the picked one tagged, matched terms, and two routes to the *real* reason:
- **📋 Copy for LLM** — copies an LLM-ready prompt (task + trajectory + tool menu + scores) to paste into Claude/ChatGPT.
- **✨ Explain (live)** — calls `onExplain` and renders the reason in place.

**`onExplain` contract** — `ctx = { trace, step, tool, prompt }`; return the explanation string. Worked wiring (neo, one-off `provider.complete`):
```ts
const explainToolChoice = async ({ prompt }: { prompt: string }) => {
  if (mode !== 'live') return 'Switch to Live to get the real explanation.';
  const resp = await liveProvider().complete({
    systemPrompt: 'You debug AI agents. In 2-4 sentences explain why the agent picked this tool and whether it was right.',
    messages: [{ role: 'user', content: prompt }],
    model: liveModel,
  });
  return resp.content;
};
```

**Files / exports:** `agentthinkingui` → `AgentThinkingUI` (props above), `ToolRack`, `ToolMenu`, `isSkillName`; `agentthinkingui/styles.css`. Brain label is `labels.agent`. Says **"Why this skill?"** when the focused entry is a skill (`load_skill`-style).

---

## Part 2 — Influence scoring: the *why* backbone ✅ SHIPPED, **LLM-free** (`agentfootprint/observe`, ≥ 6.31.0)

How much did each piece of context drive a decision — scored with **no scoring LLM** (an embedder + agent re-runs only). The validated mechanism: **proxy NARROWS → ablation CONVICTS.**

```ts
import { scoreInfluence, scoreContrastiveInfluence, rankingConfidence, findDroppedContext } from 'agentfootprint/observe';

const scores = scoreInfluence({ evidence, answerText, embedder });   // embedding proxy — NARROW
const conf   = rankingConfidence(scores);                            // honesty: clearWinner? lead? shortlist?
// content-regime sharpener (needs a reference output):
const c      = scoreContrastiveInfluence({ evidence, answerText, referenceText, embedder });
// then ablation (localizeContextBug rerun tier) CONVICTS.
```

| Export | Tier | Use |
|---|---|---|
| `scoreInfluence` | proxy (fast) | embedding relevance ranking — the NARROW |
| `scoreContrastiveInfluence` | proxy | `sim(answer) − sim(reference)` — cancels topical-innocent confounds (content bugs) |
| `rankingConfidence` | honesty | flat-top → `clearWinner:false` + a shortlist to ablate |
| `findDroppedContext` | missing | what was available but never sent (id set-diff) |
| `localizeContextBug` | causal | ablation re-runs — CONVICTS |

**Positioning:** this is a **menu of pluggable strategies** (each grounded in a cited method), all returning `InfluenceScore[]` so `rankingConfidence` + ablation compose. None requires an LLM.

**% display (the intuitive view) 🔶 PROPOSED for the Why-panel:** today the panel uses a lexical max-norm proxy. Upgrade path → use `scoreInfluence` (embedding) → **softmax-normalize → show as % confidence** ("78% / 14% / …"). Softmax is what makes the percentages meaningful (max-norm pins the top at 100% and hides close calls). The *same* LLM-free scorer can drive both this display and the `score-match` entry router (Part 3) — one scorer, two uses.

---

## Part 3 — `skillGraph()`: declarative skill routing — ✅ **v1 EXISTS** · 🔶 v2 hardening proposed

> **`skillGraph()` is real and usable today** (`src/lib/injection-engine/skillGraph.ts`, proposal 002 v1) — a **fluent builder**: `.entry(skill, {when?})` · `.route(from, to, {when | onToolReturn})` · `.tree(decide(...))` · `.build()`, plus `toMermaid()`. `defineSkill` exists. Your friend can use it now. ✅
>
> ✅ **The keystone SHIPPED (2026-06-17, panel-reviewed *SHIP WITH NITS*):**
> 1. the **keystone** `currentSkillId` on `InjectionContext` + **`from`-gating** — an edge `A→B on get_wwn` now fires **only while the cursor is on A**, so the cross-skill edge bleed is gone. The cursor is a sticky state machine: you stay in a skill until a `from`-gated edge moves you out, with a clean handoff (the leaving skill deactivates the same step the next one activates). Driven by one pure resolver `graph.nextSkill(ctx)`.
> 2. **per-matcher try/catch** — a throwing route predicate is isolated (no-match, dev-warned), never kills the loop or sibling edges.
>
> 🔶 **Still proposed on top (gated, NOT built):**
> 3. the **scoped `read_skill` gate** at `toolCalls.ts` (no `allowedSet` runtime enforcement yet — a rejected/out-of-set skill id is still appended).
> 4. the **`'score-match'`** entry strategy (embedding-softmax) — entry today is `when`-predicate / `always`.
> 5. the **grey-area governors** (oscillation / fallback-retry caps), the **`RouteDecisionRecorder`**, **build-time validation**, and (per §6.1) an optional **object-literal façade** for validation.

**v1 API (works today):**
```ts
import { skillGraph, decide } from 'agentfootprint/observe';
const graph = skillGraph()
  .entry(mdsInterface, { when: ctx => /flap|crc/.test(ctx.userMessage ?? '') })
  .route(esxiInventory, volumeLookup, { when: r => !!parse(r.result).wwn })   // predicate-on-tool-result
  .build();
Agent.create({ provider, model }).skillGraph({ skills: graph.skills }).build();
graph.toMermaid(); // draws itself
```

**The model (one graph, drawn + build-validated):**
- **Skills = nodes.** Each = instructions (a steering body) + its gated tools. Activating one injects its body into the system prompt + unlocks its tools.
- **Entry router = a consumer knob** (pick the *first* skill from the question): `'match-text'` (regex, deterministic/pinnable, brittle) · `'score-match'` (embedding-softmax, reproducible, LLM-free, needs an embedder) · `'ask-the-model'` (`read_skill`, flexible, +1 turn) · `hybrid`.
- **Transitions = predicate-on-tool-result edges** (`{ from, whenResult, to }`) — deterministic, drawn solid, build-validated. **Never regex** (they read a field).
- **Fallback** — when no predicate matches: `read_skill` scoped to the allowed set. **STAY (keep working in the current skill) is the default; routing is the exception** (see `skill-graph.md` §4A).

**Proposed API + worked example:**
```ts
// 🔶 PROPOSED — illustrative only, not implemented
const graph = skillGraph({
  skills: [
    defineSkill('mds-interface-issues', { entry: true,  instructions, tools }),  // a door
    defineSkill('volume-lookup',         { /* transition-only */ instructions, tools }), // a room
  ],
  entry: 'match-text-then-ask',          // tree fast-path, read_skill fallback (recommended default)
  // entry: { pick: 'score-match', embed: yourEmbedFn },   // LLM-free scored router (+ lexical fallback)
  steps: [
    { from: 'esxi-inventory', whenResult: r => !!parse(r).wwn, to: 'volume-lookup' }, // cross-domain hop
  ],
});
// → compiles to a footprintjs flowchart: draws itself (toMermaid), time-travel + tracing for free.
```

**Tracing the routing 🔶 PROPOSED — `RouteDecisionRecorder`** (composes the existing channels, Convention 1): one `RouteDecision` per hop (`{ runtimeStageId, currentSkillId, outcome: predicate|volunteer|fallback|stay|…, why, … }`) → powers the lens, the Why-panel, and paper figures. *No new tracing* — it composes `onDecision` evidence + subflow boundaries + emits + the commit log.

**Proposed engine changes (the only new runtime work — see `skill-graph.md` §8):** `currentSkillId` on `InjectionContext` (keystone); per-`from` gating + per-matcher try/catch in `skillGraph.ts`; the runtime activation gate at `toolCalls.ts` (reject out-of-set skill ids); per-decision scoped `read_skill` enum. Build-time-only: the object façade + validation checks. **Cut:** any `expectField` type-checker (no tool output schemas).

**Evaluation (the paper):** benchmark the three entry strategies (`match-text` / `score-match` / `ask-the-model` / `hybrid`) on routing accuracy / tokens / latency / determinism → recommend a default. The skill graph is a **skill** (control-flow / "what to do") graph — NOT a knowledge graph (facts / "what to know"); they compose.

---

## Consolidated status

| Capability | Status | Where |
|---|---|---|
| Rack tool-menu, Why panel, button, Copy-for-LLM | ✅ 0.17.0 | `agentthinkingui` |
| Live `onExplain` | ✅ 0.17.0 | `agentthinkingui` + consumer LLM |
| LLM-free influence scoring (proxy + contrastive + confidence + ablation) | ✅ 6.31.0 | `agentfootprint/observe` |
| Why-panel **% confidence** via softmax | 🔶 proposed | `agentthinkingui` (relevance scorer) |
| `skillGraph()` v1 — fluent `.entry/.route/.tree/.build`, predicate-on-tool-result routes, decision trees, `toMermaid` | ✅ **exists** | `agentfootprint` `lib/injection-engine/skillGraph.ts` |
| v2 **keystone** — `currentSkillId` + `from`-gating (sticky cursor, clean handoff, no edge bleed), per-matcher try/catch, `graph.nextSkill(ctx)` | ✅ **shipped** (2026-06-17) | `agentfootprint` `skillGraph.ts` + Injection Engine + chart mappers |
| v2 remainder — scoped `read_skill` gate, `'score-match'` entry, grey-area governors, `RouteDecisionRecorder`, build validation, object façade | 🔶 proposed, gated | `agentfootprint` — design in `skill-graph.md` |

**Gate:** everything marked 🔶 is a proposal. No code ships for it until an explicit "yes" for the specific change. Keep this file + the per-repo `AGENTS.md` in sync when any 🔶 becomes ✅.
