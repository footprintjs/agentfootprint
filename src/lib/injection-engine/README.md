# Injection Engine

The heart of agentfootprint v2's context engineering: one primitive that
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

---

## The five axes

Every Injection answers five questions:

| Axis | Field | Examples |
|---|---|---|
| **Slot** | `inject.{systemPrompt,messages,tools}` | system-prompt / messages / tools |
| **Role** (for messages) | `inject.messages[i].role` | system / user / assistant / tool |
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
| `defineInstruction` | rule | system-prompt | "If user is upset, acknowledge feelings first." |
| `defineSkill` | llm-activated | system-prompt + tools | "Billing help — body + tools loaded when LLM calls `read_skill('billing')`" |

### Context Engineering — *supply the facts*

Tell the LLM **what's true** or **what's relevant**. Data, retrievals,
recall, environment.

| Factory | Trigger | Slot(s) | What |
|---|---|---|---|
| `defineFact` | always or rule | system-prompt or messages | User profile, env info, computed summary |
| `defineRAG` (v2.1+) | rule (retrieval score) | messages | Knowledge-base chunks |
| `defineMemory` (v2.1+) | rule (recency) | messages | Prior turns, extracted facts |

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
prompt.

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
│                │  scope.activatedInjectionIds, scope.lastToolResult
└────┬───────────┘
     │
     │ — next iteration —
     │
     ▼
   loop ↑    InjectionEngine runs AGAIN with updated state
            (new lastToolResult, new activatedInjectionIds, new history)
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

## Adding a new flavor (v2.1+)

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

## v2.0 surface — locked

Four sugar factories ship in v2.0:

```typescript
import {
  defineInstruction,    // rule-based system-prompt guidance
  defineSkill,          // LLM-activated body + tools (turn-scoped)
  defineSteering,       // always-on system-prompt rule
  defineFact,           // always/rule data injection
} from 'agentfootprint';

const agent = Agent.create({ provider, model: 'mock' })
  .steering(jsonOnly)
  .instruction(calmTone)
  .skill(billingSkill)
  .fact(userProfile)
  .build();
```

v2.1+ adds: `defineRAG`, `defineMemory`, `defineGuardrail`. Same
pattern. No engine change.

**This is the architecture. One primitive. Many recipes.**
