# Injection Engine

The heart of agentfootprint context engineering: one primitive that
does one thing, exhaustively.

> **Every piece of content reaching an LLM is either:**
> **(a) baseline** — the user's message, a tool's return — or
> **(b) an Injection: content YOU engineered into one of the LLM's
> three slots, when YOU decided it should land.**
>
> **The Injection Engine evaluates "WHEN" once per iteration. The slot
> subflows place "WHAT" into the right slot. Every named flavor —
> Skill, Steering, Instruction, Fact, RAG, Memory — is sugar over the
> same primitive.**

---

## Why this exists

LLM API calls accept exactly three slots:

```
┌────────────────┬─────────────────────┬─────────────┐
│ system-prompt  │       messages      │    tools    │
└────────────────┴─────────────────────┴─────────────┘
```

Every "feature" in any agent framework — RAG, Skills, Memory, Steering
docs, Tool gating, Few-shot examples — is ultimately *content placed
into one of those three slots, under some condition*.

Other frameworks invent N concepts (Chain, Retriever, MemoryStore,
PromptTemplate, OutputParser, SkillRegistry, Plugin, …) that all do the
same underlying thing differently. agentfootprint defines **one**
primitive — the `Injection` — and exposes named factories on top.

This is the library's DNA: **context engineering, visible.**

---

## The primitive

```typescript
interface Injection {
  readonly id: string;
  readonly description?: string;
  readonly flavor: ContextSource;     // 'skill' | 'instructions' | 'steering' | 'fact' | …

  // WHEN — exactly one of four trigger kinds
  readonly trigger:
    | { kind: 'always' }
    | { kind: 'rule'; activeWhen: (ctx: InjectionContext) => boolean }
    | { kind: 'on-tool-return'; toolName: string | RegExp }
    | { kind: 'llm-activated'; viaToolName: string };

  // WHAT — multi-slot per Injection
  readonly inject: {
    readonly systemPrompt?: string;
    readonly messages?: ReadonlyArray<{ role: ContextRole; content: string }>;
    readonly tools?: readonly Tool[];
  };
}
```

That's it. Five fields. Four trigger kinds. Three slot targets. **One
Injection can target multiple slots** — Skills inject `body` into
system-prompt AND `tools` into the tools slot, atomically.

`inject.messages` is DELIVERY (7.21.0): the agent's `Deliver` stage appends those
messages to `scope.history` itself, so the window strategies, the slot projection
and the wire all see one conversation. Two wire rules govern it — a role the
attached provider does not carry inside `messages` is refused when the run starts
(`LLMProvider.carriesInMessages`), and a role that would repeat the turn at the
end of the window is deferred to the next boundary and recorded on
`messagesDelivery.deferred`. `role` is required and has no default.

---

## The five axes

Every Injection answers five questions:

| Axis | Field | Examples |
|---|---|---|
| **Slot** | `inject.{systemPrompt,messages,tools}` | system-prompt / messages / tools |
| **Role** (for messages) | `inject.messages[i].role` | system / user / assistant — required, and checked against what the provider carries |
| **Flavor** | `flavor` | instructions / skill / steering / fact / rag / memory / … |
| **Timing** | `trigger.kind` | always / rule / on-tool-return / llm-activated |
| **Decision** | `trigger` shape | rule-based or LLM-guided |

Lens displays exactly this — one chip per Injection per slot it lands
in, color-coded by flavor, decorated with timing + decision icons.
**The same picture teaches the whole model.**

---

## Two sub-disciplines of context engineering

The Injection Engine handles two related-but-distinct intents:

### Instruction Engineering — *shape the behavior*

Tell the LLM **what to do** or **how to act**. Rules, guidance, persona,
tone, safety policies, skill-gated capabilities.

| Factory | Trigger | Slot(s) | What |
|---|---|---|---|
| `defineSteering` | always | system-prompt | "Always respond in JSON." |
| `defineInstruction` | rule | system-prompt, or messages with a role | "If user is upset, acknowledge feelings first." |
| `defineSkill` | llm-activated | system-prompt + tools | "Billing help — body + tools loaded when LLM calls `read_skill('billing')`" |

### Context Engineering — *supply the facts*

Tell the LLM **what's true** or **what's relevant**. Data, retrievals,
recall, environment.

| Factory | Trigger | Slot(s) | What |
|---|---|---|---|
| `defineFact` | always or rule | system-prompt, or messages with a role | User profile, env info, computed summary |
| `defineRAG` | rule (retrieval score) | system-prompt | Knowledge-base chunks |
| `defineMemory` | rule (recency) | system-prompt | Prior turns, extracted facts |

**Same engine, same Injection primitive, same observability, same Lens
chips — different intent.** That symmetry is the library's DNA.

---

## The four trigger kinds

### `{ kind: 'always' }` — steering

Always active. Use for invariant guidance.

```typescript
defineSteering({
  id: 'json-only',
  prompt: 'Always respond with valid JSON. No prose.',
});
```

### `{ kind: 'rule'; activeWhen }` — conditional instruction

A predicate runs once per iteration. Most flexible.

```typescript
defineInstruction({
  id: 'calm-tone',
  activeWhen: (ctx) => /upset|angry|frustrated/.test(ctx.userMessage),
  prompt: 'Acknowledge feelings before facts.',
});
```

### `{ kind: 'on-tool-return'; toolName }` — Dynamic ReAct

Fires after a specific tool returns, before the next LLM call. The
"Dynamic ReAct" pattern — tool results steer the next iteration's
prompt. Since 9.16.0 the trigger matches against EVERY result of a
parallel tool batch (`ctx.toolResults`, call order), not only the last
call; `ctx.lastToolResult` remains the batch's last entry.

```typescript
const piiPolicy = defineInstruction({
  id: 'pii-after-redact',
  // (uses rule trigger — same effect, predicate inspects lastToolResult)
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'PII redacted. Do not include emails or phone numbers.',
});
```

### `{ kind: 'llm-activated'; viaToolName }` — skill

The LLM activates this Injection by calling a designated tool. Most
common: `read_skill(<id>)` auto-attached when Skills are registered.
Once activated, the Skill is active for the rest of the **turn**
(`agent.run()` call). Resets each turn.

```typescript
defineSkill({
  id: 'billing',
  description: 'Use for refunds, charges, billing questions.',
  body: 'When handling billing: confirm identity first, then…',
  tools: [refundTool, chargeHistoryTool],
});
// Auto-attaches `read_skill` tool. LLM calls read_skill('billing') →
// next iteration's system-prompt + tools slot include this Skill.
```

---

## How it fits into the agent's flow

```
┌─────────┐
│  Seed   │  initialize state, push user message into history
└────┬────┘
     │
     ▼
┌─────────────────────┐
│  InjectionEngine    │  ← evaluates every Injection's trigger,
│  (this subflow)     │     writes activeInjections[] to scope,
│                     │     emits agentfootprint.context.evaluated
└────┬────────────────┘
     │
     ▼
┌────────────────┬─────────────────────┬─────────────────┐
│ SystemPrompt   │     Messages        │     Tools       │
│ slot subflow   │  slot subflow       │  slot subflow   │
│                │                     │                 │
│ Reads          │ Reads               │ Reads           │
│ active[],      │ active[],           │ active[],       │
│ filters by     │ filters by          │ filters by      │
│ inject.        │ inject.messages     │ inject.tools    │
│ systemPrompt   │                     │                 │
│                │ Emits               │ Emits           │
│ Emits          │ context.injected    │ context.injected│
│ context.       │                     │                 │
│ injected       │                     │                 │
└────────────────┴─────────────────────┴─────────────────┘
     │
     ▼
┌─────────┐
│ CallLLM │  3 slots filled, send to provider
└────┬────┘
     │
     ▼ (if tools requested)
┌────────────────┐
│  Tool Exec     │  agent intercepts read_skill, sets
│                │  scope.activatedInjectionIds, scope.lastToolResult,
│                │  scope.toolResults (the whole batch, call order)
└────┬───────────┘
     │
     │ — next iteration —
     │
     ▼
   loop ↑    InjectionEngine runs AGAIN with updated state
            (new toolResults batch, new activatedInjectionIds, new history)
            → activeInjections[] is DIFFERENT now → slots recompose
```

**Key insight: the engine runs at the start of EVERY iteration.** The
LLM sees a different prompt + different tools each pass because the
state has evolved. That's "Dynamic ReAct."

---

## Events emitted

| Event | When | Payload |
|---|---|---|
| `agentfootprint.context.evaluated` | Engine subflow exit, once per iteration | `{ activeCount, skippedCount, evaluatedTotal, activeIds, skippedDetails, triggerKindCounts }` |
| `agentfootprint.context.injected` | Per slot subflow, per InjectionRecord placed | full InjectionRecord with `slot`, `source` (= flavor), `reason`, `sourceId`, … |
| `agentfootprint.context.slot_composed` | Per slot subflow exit | `{ slot, iteration, injections, dropped, budgetSpent }` |

Adding a flavor adds NO new events — just new `flavor`/`source` values.

---

## Adding a new flavor

A new flavor is one file in `factories/`. Engine doesn't change.

```typescript
// factories/defineGuardrail.ts
import type { Injection } from '../types.js';

export interface GuardrailOptions {
  readonly id: string;
  readonly checker: (ctx) => boolean;
  readonly violationPrompt: string;
}

export function defineGuardrail(opts: GuardrailOptions): Injection {
  return {
    id: opts.id,
    flavor: 'guardrail',     // (add to ContextSource union)
    trigger: { kind: 'rule', activeWhen: opts.checker },
    inject: { systemPrompt: opts.violationPrompt },
  } as unknown as Injection;
}
```

Then add `'guardrail'` to `ContextSource` and ship. **One new factory
file per flavor. Zero engine change. Zero new events.** Lens picks it
up automatically with a "guardrail"-color chip.

---

## Why a subflow, not a stage

The Injection Engine is its own subflow because:

1. **Pedagogy.** A student asking *"why didn't my Skill activate?"*
   needs to drill into the engine's trigger evaluation. Subflows drill;
   stages don't.
2. **Isolation.** Engine has its own scope — cannot accidentally
   trample agent state.
3. **Observability.** `onSubflowEntry` / `onSubflowExit` boundaries
   give Lens a clean span for *"engine ran for X ms, evaluated N
   triggers."*
4. **Symmetry.** The 3 slot subflows are subflows. The engine being a
   subflow makes the architecture consistent — *"each subflow stands
   alone on its own working."*

The cost is ~50 microseconds of subflow ceremony per iteration. Worth
it.

---

## Module map — the skill-graph family

One job per file; small composable modules. Import direction flows DOWN
this table (a lower row never imports a higher one):

| file | one job |
|---|---|
| `skillGraph.ts` | the compiler: fluent/object form → `SkillGraph` (per-skill triggers + drawn topology + the ONE cursor resolver, `makeResolveCursor`). Owns `toMermaid()` and the build-time `check` gate; stamps `autoActivate: 'currentSkill'` on tree leaves and (with `scopeTools: true`) on wired flat skills — always `existingAuto ?? …`, a default, never an override. SG-C: `.classify(scorer, policy?)`, the resolver's iteration-1 `turnRoute` clause, and the `turnRouting`/`entrySelection`/`checkupIntents` surfaces |
| `entryScorer.ts` | `EntryScorer` strategies (`keywordScorer`, `embeddingScorer`) — rank the entry menu; the engine owns the `when`-filtering. Both factories are ALSO `IntentScorer`s (a second arity — candidates array as the 2nd argument); keyword declares `floor: 0`, embedding declares NO floor unless you pass one |
| `intentScorer.ts` | the `IntentScorer` PORT (SG-C tier 2) + `validateIntentScores` (every candidate scored, no foreign ids — the custody split: scorers produce numbers, the framework decides) |
| `routingPolicy.ts` | the cascade's tie policy: `NEAR_TIE_MARGIN`/`MENU_SIZE`/`RoutingPolicy` + `decideTier2` (pure; floor + TOP-2 PAIRWISE margin, count-independent) + the `TurnRoute` POJO and `menuOutstanding` (ONE implementation for the envelope, the cursorMove decoration and the guard gate) |
| `skillIntent.ts` | the intent domain: `TurnRoutingPlan` (what the agent's RouteTurn stage consumes), candidate projection (incumbent included), duplicate-example normalization, and the leave-one-out `checkupIntents` audit |
| `llmClassifier.ts` | the model-judged `IntentScorer`: ONE constrained-enum call per turn over `constrainedEnumPick` (off-enum = `'none'`, never a fabricated id) |
| `constrainedEnumPick.ts` | the enum machinery itself (9.19.0 extraction): forced synthetic tool where the provider declares `carriesForcedToolChoice`, strict single-line parse + one structured re-ask + the caller's fallback elsewhere. Shared by `llmClassifier` and the agent's tier-3 DECIDER (`SkillGraphOptions.decider` — the out-of-band menu resolver, `turn_routed { by: 'decider' }`, the sanctioned resolver for rails menus) so the two disciplines can never drift |
| `factories/defineMenuHint.ts` | the tier-3 envelope's system-prompt half — advisory note while a menu is outstanding; auto-registered by Agent build on cascade graphs (marker `MENU_HINT_METADATA_KEY`, never the id) |
| `skillContract.ts` | skill-body ↔ tool-contract checks (`body-foreign-tool` / `body-unknown-tool`). When a graph builds WITHOUT `knownTools`, these are DEFERRED via `SkillGraph.deferredBodyContract` — the note also rides each compiled skill's metadata (`SKILL_GRAPH_DEFERRED_CONTRACT_KEY`), so Agent build runs them once against the real registry whichever door the skills arrive through (`.skillGraph(graph)` or `.skills({ list: () => graph.skills })`; one problem, one report) |
| `skillGraphCheckup.ts` | pure wiring lint (`checkupGraph`): reachability, entry fan-out, rule shadowing/overlap (re-enabled under a classifier — declaration order is back), `intent-without-classify`. Pure over strings — never imports engine types (`skillContract`/`skillIntent` borrow its `GraphProblem` shape so all checks report in one voice) |
| `skillExamples.ts` | the declared-phrasings domain (SG-G): `validateStartRuleExamples` (every teaching refusal for a rule-level `examples` list) + `checkStartRuleExamples` (the witness properties — `example-misses-own-rule`, `example-shadowed-by-earlier`, `example-shadowed-by-default`, `example-unclaimed` — by RUNNING the compiled predicates in declaration order under BOTH start laws, the cold walk and tier-1 `firstRuleMatch`, and asserting an ERROR only where they agree) + `EXAMPLES_BOUNDARY` (the report's statement about its own reach, carried on `GraphCheckup.notes`). Reads declarations only; runs nothing at run time |
| `skillMatch.ts` | the data-matcher domain (`match:` on start rules): `SkillMatch`/`SkillMatchData` (regex · keywords · intent), `compileMatch` (ONE compilation → the predicate that routes + the data that describes it; the intent arm compiles to NO predicate — the classifier judges it), `compareMatchers` (only what is provable), `mermaidMatchCaption`. Engine-type-free leaf — imported by `skillGraph.ts` (compile + caption) and `skillGraphCheckup.ts` (compare); imports nothing |
| `hostContract.ts` | the BOUNDARY contract (9.34.0): `SkillTool` / `SkillToolSchema` / `SkillToolDescriptor` (what a tool looks like to the graph, and how the graph describes one without building it), `SkillCachePolicy` (structural mirror of `cache/types.ts`), and `SkillGraphHost` — the five obligations a host owes the graph, as documentation-that-typechecks. Zero imports, by construction |
| `skillToolDescriptors.ts` | the graph DESCRIBING `list_skills` + `read_skill`: the enum, the reachability offer, the turn-start menu, the per-`surfaceMode` result. `skillTools.ts` is the one line that wraps each descriptor in `defineTool` |
| `toolOutcome.ts` | the six-value `ToolResultStatus` vocabulary `onToolStatus` edges key on. A zero-import leaf both sides read; `core/agent/toolEffects.ts` re-exports it and keeps the envelope grammar |
| `devWarn.ts` | the dev-warning seam: the pure core asks a bound reader instead of importing footprintjs's `isDevMode`. `devWarnHost.ts` (host zone, side-effect module) does the binding for this package |

Seams: a new matcher kind = a new arm in `skillMatch.ts` (`SkillMatch` +
`SkillMatchData` + `compileMatch` + optionally `compareMatchers`) — no
reshape anywhere else. A new checkup code = `GraphProblemCode` +
a numbered block in `checkupGraph` (build refusals that cannot compile at
all, like `rule-id-exists`, throw from `skillGraph.ts`'s config
translation instead) — or, when the check needs more than strings (running a
predicate, reading a skill body), a DOMAIN module composed into `checkup()`
beside `skillContract`/`skillIntent`/`skillVocabulary`/`skillExamples`, which
owns both the rule and the statement of its boundaries. The check-up compares only DATA — `when`
predicates are opaque, and every message says so. A new intent scorer =
implement `IntentScorer` (numbers for EVERY candidate; declare `floor` only
when a low score honestly means "did not match at all", `categorical` only
when the answer is one-id-or-none).

Two 9.19.0 seams worth naming. **Route edges take a third condition**,
`onToolStatus` (data, drawable — `on … status=denied` in `toMermaid()`):
route on a tool result's DECLARED outcome (the six-value `ToolResultStatus`
vocabulary from `toolOutcome.ts`, re-exported by `core/agent/toolEffects.ts`) instead of its prose; a result
with no declared status can never match, `when` + `onToolStatus` together is
refused, and every determinism filter goes through the ONE
`isDeterministicRoute` predicate. **The cursor resolver takes a fourth
clause**, `ctx.pendingToolTransition` — an accepted `propose-transition`
tool effect, ranked BETWEEN the declared edges (D1 still wins; the
suppression is `reroute_superseded { source: 'tool-proposal' }`) and the
model's pick (deterministic tool code outranks a model guess) — recorded as
`cursorMove.by: 'tool-proposal'`. The evaluator also honors ONE
framework-tier admission: `ctx.leaseActiveIds`, the `require-instruction`
push (a granted lease serves the named injection into the pass, whatever
its own trigger said; `read_skill` stays the pull door). Lease death is
made PERMANENT by the Evaluate **tenure sweep**: every pass where
`instructionLeases` arrives, the stage writes the `pruneLeases` survivors
under `nextInstructionLeases` (the cursor's alias round trip — the mount
mappers carry them back onto the parent key), so an `'until-skill-exit'`
lease leaves the record the same pass its tenure ends and a cyclic graph's
re-entry into the granting skill finds nothing to resurrect.

---

## The fence — `agentfootprint/skill-graph` (9.34.0)

**What the subpath is for.** A skill graph is a decision layer, not a
runtime. Given one iteration's `InjectionContext` it answers three questions
— where is the cursor, what is reachable from here, which injections are
active — with plain functions over plain data. `agentfootprint/skill-graph`
publishes exactly that layer, so a host that is **not** our agent (another
agent framework, a router, a test harness) can import it and route with it.

**The claim is proved, not asserted.**
`test/lib/injection-engine/skill-graph-fence.test.ts` walks the *transitive*
import graph of everything reachable from `src/doors/skill-graph.ts` — using
the TypeScript parser, so `import type`, `export … from`, `await import()`
and inline `` import('…').T `` are all seen — and fails on any edge that
reaches `footprintjs`, `core/agent/*`, `core/tools.ts`, an adapter or a
recorder. It names the offending file, the offending import, and what to do
instead.

That test is the actual feature. The boundary was already pointing the right
way — the loop depends on the graph, never the reverse — but nothing
*enforced* it, so it eroded one free import at a time: `isDevMode` for a dev
warning, the loop's `ToolResultStatus` inside the graph's own context type,
the framework's `Tool` (and behind it artifacts, credentials, check-in, tool
sessions) for a five-field tool shape. A comment saying "keep this pure" does
not survive three minor releases. A fence does.

**Two zones, because one of them honestly cannot be pure.**

| zone | files | may import |
|---|---|---|
| PURE CORE | the 18 files in the module map above, plus `types.ts` / `evaluator.ts` / `softmax.ts` | each other, and three verified zero-import leaves: `events/types.ts` (`ContextRole`/`ContextSource`), `memory/embedding/types.ts` (`Embedder`), `memory/embedding/cosine.ts` |
| PROVIDER LAYER | `constrainedEnumPick.ts`, `llmClassifier.ts` | the above **plus** `adapters/types.ts` |

The provider layer is deliberately outside the pure boundary, and
deliberately **not** on the door. Both files make a MODEL CALL — a
constrained-enum pick *is* one — so they need an `LLMProvider`. A port that
pretended otherwise would be a fake abstraction: it would move the
dependency, not remove it. Import them from `agentfootprint/context` when you
want the turn-start classifier cascade.

Everything else in this folder is the HOST zone (the factories, the subflow,
`skillTools.ts`, `SkillRegistry.ts`), where importing the framework is the
job. The fence does not inspect those, but it does insist every file in the
folder is *placed* in exactly one zone — a new file cannot arrive
unclassified.

**The honest cost: `footprintjs` is still a required peer dependency.** It is
listed in `peerDependencies` and is *not* marked optional in
`peerDependenciesMeta`, so npm installs it beside you even if
`agentfootprint/skill-graph` is the only path you ever import. This door never
loads it — that is what the fence proves — but the package is not split, and
the rest of agentfootprint genuinely needs the engine. You pay the install,
not the import. Splitting the package is the only thing that would change
that, and it is not on the table for a 9.x minor.

**What a host owes the graph** is written down as a type: `SkillGraphHost`,
five obligations, each naming the code in this package that implements it.
Advance the cursor exactly once per iteration off the SAME ctx the triggers
read (the keystone); enforce `reachableSkills` at pick time; publish
`pendingSkillPick` only after acceptance, and clear it every iteration; carry
the advanced cursor into the next iteration; emit the routing decisions.
`buildInjectionEngineSubflow.ts` + `core/agent/stages/toolCalls.ts` are its
reference implementation. It is documentation-as-a-type — nothing constructs
one, nothing consumes one, and implementing it does not start a run. This
package still has exactly one run door.

**Not claimed:** nobody has yet run this from another framework. The fence
proves the import graph, which is a fact about the code; it does not prove
ergonomics, which is a fact about experience we do not have.

**Also not on the door:** the sugar factories (`defineSkill`,
`defineInstruction`, …). They resolve cache policies and validate against the
framework's `Tool`, so they stay host-side on `agentfootprint/context`. A
foreign host builds `Injection` objects directly — five fields, all data.

---

## The turn-start routing cascade (SG-C, 9.17.0)

**Why:** a graph's entries used to be routed by predicates (binary), a scorer
(argmax — near-ties coin-flip), or the model (every turn a judgment call).
None of those can say *"this message decisively means refunds"*, *"these two
were too close to call"*, or *"this is a follow-up — stay put"* — and none of
it survived a `followUp()`. The cascade makes the turn's start a RECORDED
DECISION: declared rules first, then a classifier over declared intents (with
an explicit floor + near-tie margin), then — only on declared ambiguity — a
menu the model resolves. Scorers are a tier, never a correctness dependency:
near-ties fall through, and every verdict (winners, losers, thresholds) lands
on `agentfootprint.skill.turn_routed`.

```typescript
import { Agent } from 'agentfootprint';
import { skillGraph, keywordScorer } from 'agentfootprint/context';

const graph = skillGraph({
  skills: [billing, shipping],
  start: {
    rules: [
      { use: 'billing',  match: { intent: 'customer wants a refund',
                                  examples: ['refund my order', 'charged twice'] } },
      { use: 'shipping', match: { intent: 'customer asks where a delivery is',
                                  examples: ['track my parcel'] } },
    ],
    classify: keywordScorer(),           // or embeddingScorer(e) / llmClassifier(p)
    // routing: { nearTieMargin: 0.2 },  // the ONE override home, beside its scorer
  },
});

const agent = Agent.create({ provider, model })
  .skillGraph(graph, {
    continuity: 'conversation', // followUp() starts where the last turn ended
    strictness: 'guard',        // the model routes only from an offered menu
  })
  .build();
```

Runs once per turn, off the hot loop (the RouteTurn stage in PickEntry's
slot); iterations 2..N keep the 8.x law byte-for-byte. `graph.checkupIntents()`
audits the declared examples with the CONFIGURED scorer (leave-one-out).
Everything is zero-cost when unused: a graph without `classify`/`continuity`
mounts no stage, writes no key and emits no new event.

---

## Examples on start rules (SG-G)

**Why:** `compareMatchers` claims only what matcher-vs-matcher analysis proves,
and says so — two DIFFERENT regex sources return `undefined` ("regex
intersection is not decided here — only identity is provable"). One production
deployment hit two failures in one evening that this honesty could not report:
an earlier product-name rule that swallowed an inventory rule's phrase (two
different regexes — correctly silent), and a phrase that matched **no** rule at
all and fell through to the model tier, which then picked the wrong skill
(absence — nothing about comparing matchers could ever catch it).

A declared phrase turns both into arithmetic. `examples: [...]` beside a rule's
`match`/`when` is the phrasings that rule CLAIMS; the check-up runs the compiled
predicates over each phrase in declaration order, on ONE context — iteration 1,
the phrase as `userMessage`, empty `history`, no cursor — and reports a WITNESS:

| code | severity | proves |
|---|---|---|
| `example-misses-own-rule` | error / warning | the rule does not claim its own example. ERROR for a DATA matcher (it reads the user message and nothing else, so the no-match holds under every context) or a predicate that THREW; WARNING for an opaque `when` that returned false — it may be gated on conversation state (`ctx.history.length > 0`) and claim the phrase on a later turn, which a build-time check cannot run. The message names the context it judged under |
| `example-shadowed-by-earlier` | error | an earlier rule claims the phrase first — the case matcher comparison must stay silent about. Claimed only where BOTH start laws agree |
| `example-shadowed-by-default` | warning | the earlier claimant is an UNCONDITIONAL entry, the ONE place the two laws differ — the report names both readings instead of asserting one |
| `example-unclaimed` | warning | nothing claims the phrase on that context; the turn falls to the next tier. Where the graph's examples are the corpus, this is COVERAGE |

**Two start laws, and why the check-up will not pick one.** The declaration-order
cold walk (`makeResolveCursor`, the default mount) stops at the first entry with
no condition; the turn-start cascade's tier 1 (`firstRuleMatch`) reads the
CONDITIONAL non-intent entries only, and that cascade is mounted by `.classify()`
**and** by `.skillGraph(g, { continuity: 'conversation' })` — an AGENT-MOUNT
option that does not exist when the graph is built. The two differ in exactly one
place: whether an unconditional entry claims. So a default earlier than the owner
is reported as `example-shadowed-by-default` (warning, both readings named), and
the ERROR is kept for what both laws agree on. A check-up that contradicts the
router is worse than no check-up: with `continuity: 'conversation'` the router
really does start that turn on the later rule.

Zero-cost when unused (one `Array.some` and out), and **fed to nothing at run
time**: a rule with examples routes byte-identically. The tier difference is
load-bearing and refused at build if blurred — `match: { intent, examples }`
examples are SCORING material the classifier reads every turn; a rule-level
`examples` list is TEST material read once at build. One rule may not carry both.

The boundary rides the report itself (`GraphCheckup.notes`, rendered by
`formatCheckup` as `[note]`): *these checks prove things about the phrases you
DECLARED and nothing about phrases nobody wrote — no warning here is not proof of
coverage.* Same voice as "absence of a refusal is not consent": a reader who
meets that sentence only in prose docs meets a clean report first.

### The second door, designed and NOT built: a detached corpus

The planned second spelling is a corpus passed to the check — entries carrying
`{ phrase, expect: skillId }` — proving the same three properties over phrases
that no rule had to own:

```ts
// DESIGN ONLY — not implemented.
graph.checkup({ corpus: [{ phrase: "what's running on shpstrprncl101", expect: 'array-inventory' }] });
```

The rule form ships first for two reasons. First, the corpus form needs an
`expect` per entry, which the rule form gives BY CONSTRUCTION — an example
written on a rule already names the skill that should claim it, so there is no
second field to keep true. Second, a detached corpus DRIFTS: it lives away from
the rules it tests, so renaming a skill or deleting a rule leaves entries
asserting about a graph that no longer exists, and the check would then be
reporting on the corpus rather than on the graph. The rule form cannot drift —
delete the rule and its examples go with it. The corpus door earns its keep only
where the phrases outnumber the rules (a captured-traffic file), and it should
arrive as a separate input to the same three checks, never as a second
implementation of them.

---

## Steps as data (9.18.0)

**Why:** a skill's body could always *describe* a procedure ("look up the
order, then refund, then file the receipt"), but prose in the system prompt
decays with context length and the model can call any tool at any time — the
order was a hope, not a mechanism. `steps` makes the procedure DATA, and the
framework enforces it at the protocol level: while the skill holds the
tenure, the tools slot sends ONLY the current step's tool (its description
led by `[Step k of n — <note>]`) plus `skip_step`. A schema that was never
sent cannot be called — the sequence is owned with zero refusal machinery.
The model keeps the judgment *inside* each step: run it, skip it with a
recorded reason, use an escape hatch, or stop and say why.

```typescript
import { Agent } from 'agentfootprint';
import { defineSkill } from 'agentfootprint/context';

const refund = defineSkill({
  id: 'refund',
  description: 'Handles refunds end to end, by declared procedure.',
  body: 'Follow the refund procedure. Every step says why it exists.',
  tools: [findOrder, checkHistory, issueRefund, fileReceipt],
  steps: [
    { tool: 'find_order',    note: 'find the order before touching money' },
    { tool: 'check_history', note: 'confirm the duplicate charge' },
    { tool: 'issue_refund',  note: 'refund the duplicate charge only' },
    { tool: 'file_receipt',  note: 'file the receipt for audit' },
  ],
  onSkip: 'advance', // the default; 'hold' keeps a skipped step current
});

const agent = Agent.create({ provider, model }).skill(refund).build();
```

What the model experiences, per iteration:

- the current step's tool leads with the banner —
  `[Step 2 of 4 — confirm the duplicate charge] check_history.`;
- every boundary result renews the position — `"…Step 2 of 4 done. Now on
  step 3 of 4: refund the duplicate charge only (tool: \`issue_refund\`)."` —
  so the guidance that matters *now* never decays out of attention (this is
  the job the deprecated `refreshPolicy` promised and never did);
- `skip_step(reason)` records a decline (`skill.step_skipped`) and moves or
  holds per the declared `onSkip`;
- the **escape hatches stay offered** under narrowing — `read_skill`,
  `list_skills`, every OTHER active skill's tools, the baseline `.tool()`
  registry, provider tools. The hold-out touches only names whose sole
  active owner is the stepped skill. An input the author never imagined
  still has the whole normal surface;
- a premature final gets ONE teaching nudge (`steps_unfinished
  { action: 'nudged' }` — the `route.ts` step-nudge branch, an ordinary
  loop turn); a second stop is honored (`'accepted'`); a limit ending the
  turn is honored too (`'cut-short'`). Never a forced continue.

Mechanics, for the maintainer: **`skillSteps.ts` is the ONE owner of the
grammar** — types, validation, the pointer's re-key rule, and every sentence
the model reads. The pointer (`scope.stepPointer`) is strictly subordinate to
the skill-graph cursor: the Evaluate stage re-keys it at the same stage the
cursor truth lives (alias discipline: `stepPointer` in as a readonly input,
the fresh value out under `nextStepPointer` — the `nextSkillCursor` pattern),
and the tool-calls stage advances/skips it at EVERY result boundary,
including the pausable resume paths — a step whose tool called `askHuman`
advances when the person answers. Steps are turn-scoped: a cursor move away
resets the pointer, and under `continuity: 'conversation'` only the CURSOR
carries — a re-tenured skill starts at step 1. A step whose tool is not the
skill's own, `steps: []`, an empty note, and `onSkip` without `steps` are all
refused at `defineSkill`; steps on an OPEN skill of a graph agent (a tenure
that could never begin), steps anywhere on a decision-`tree()` agent (a tree
routes by predicate and never writes a cursor — leaf or beside-the-tree
alike, the tenure could never begin either) and `reactMode: 'classic'` (a
frozen offer) are refused at `Agent.build()`. Zero-cost when unused: no stepped skill means no
`skip_step`, no scope key, no event, no slot change — byte-identical.

Events: `skill.step_advanced` · `skill.step_skipped` · `skill.steps_unfinished`.
Runnable end-to-end: `examples/context-engineering/16-skill-steps.ts` (a
6-step refund with one human-approval pause and one recorded skip).

---

## API surface

Four sugar factories ship :

```typescript
import { defineInstruction, defineSkill, defineSteering, defineFact } from 'agentfootprint/context';

const agent = Agent.create({ provider, model: 'mock' })
  .steering(jsonOnly)
  .instruction(calmTone)
  .skill(billingSkill)
  .fact(userProfile)
  .build();
```

Future flavors planned: `defineRAG`, `defineMemory`, `defineGuardrail`. Same
pattern. No engine change.

**This is the architecture. One primitive. Many recipes.**
