# Instructions — Conditional Context Injection

> **The hook:** some rules should only apply *sometimes*. An instruction lets you say "when X is true, tell the LLM Y." Plain prompts can't do that — they're always on. Instructions are the conditional layer.

An instruction is a rule-based **Injection**: a predicate (`activeWhen`) runs once per ReAct iteration, and when it matches, the instruction's `prompt` text is added to that iteration's context. By default it lands in the **system prompt**; set `slot: 'messages'` to land it in the recent-messages window instead (higher attention weight). Instructions are one flavor of the unified Injection primitive — siblings include `defineSteering` (always-on), `defineSkill` (LLM-activated, can unlock tools), and `defineFact` (developer-supplied data).

**Background:** the activate-when-condition-holds pattern is essentially **production rules** (forward-chaining rule systems — Newell 1973, OPS5, Rete networks) applied to LLM context. The predicate reads an **`InjectionContext`** — a bounded, read-only snapshot of the iteration state (`iteration`, `userMessage`, `history`, `lastToolResult`, `activatedInjectionIds`) — which is the **belief state** the dialog-state-tracking literature (Williams et al. 2016) uses the same idea for.

## Defining an Instruction

```typescript
import { defineInstruction } from 'agentfootprint';

const refundInstruction = defineInstruction({
  id: 'refund-handling',
  description: 'Empathetic guidance once an order is denied.',

  // Predicate runs once per iteration against the InjectionContext snapshot.
  // Fires on the iteration AFTER the LLM called lookup_order. Inspect
  // ctx.lastToolResult.result to branch on the returned content.
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'lookup_order',

  // The text appended when the predicate matches.
  prompt: 'Handle denied orders with empathy. Follow refund policy. Do NOT promise reversal.',

  // Default slot is 'system-prompt'. Use 'messages' for higher-attention,
  // turn-salient reminders (post-tool-result corrections, urgent nudges).
  slot: 'messages',
  role: 'system', // role used only when slot === 'messages' (default 'system')
});
```

`activeWhen` receives an `InjectionContext` — a read-only snapshot of the current iteration:

| Field | Meaning |
|-------|---------|
| `iteration` | 1-based ReAct iteration count |
| `userMessage` | the message that started this turn |
| `history` | conversation so far (role / content / optional `toolName`) |
| `lastToolResult` | `{ toolName, result }` from the previous iteration, if it ended in a tool call |
| `activatedInjectionIds` | ids of Skills the LLM has activated this turn |

A predicate that **throws is fail-OPEN** — the instruction is skipped (does not fire) and the miss is reported on the `agentfootprint.context.evaluated` event.

> **Instructions inject text only.** To give the model *tools* conditionally, use `defineSkill({ tools })` (LLM-activated) or attach them up front with `agent.tool()`. `defineInstruction` has no `tools` field — keeping the "what fires" (a rule) separate from "what's unlocked" (a capability).

## Attaching to an Agent

```typescript
import { Agent } from 'agentfootprint';

const agent = Agent.create({
  provider,
  model: 'claude-sonnet-4-5',
  reactMode: 'dynamic', // default — re-evaluate every instruction each iteration
})
  .system('You are a customer support agent.')
  .tool(lookupOrder)
  .instruction(refundInstruction)           // singular — takes one Injection
  .instructions([compliance, adminAccess])  // plural — takes an Injection[]
  .build();
```

`reactMode` lives in `Agent.create({ ... })`, not as a builder method:

- **`'dynamic'`** (default) — the InjectionEngine and all three slots (system-prompt ‖ messages ‖ tools) re-run every iteration, so `activeWhen` predicates are re-evaluated each turn. Use this whenever any instruction's outcome can change mid-run.
- **`'classic'`** — context is engineered once; only the messages slot loops. Use only when the system prompt and tool set are fixed for the whole run.

## How It Works

```
Seed
  → [InjectionEngine]   evaluates each Injection's trigger against InjectionContext
  → [SystemPrompt]      base prompt + active system-prompt injections
  → [Messages]          base messages + active 'messages'-slot injections
  → [Tools]             base tools + tools from active Skills
  → CallLLM → ParseResponse → RouteResponse
      └── tool-calls → [ToolCalls] runs tools; result becomes next ctx.lastToolResult
  → loopTo (dynamic: back to InjectionEngine)
```

Each iteration in `reactMode: 'dynamic'`:
1. The **InjectionEngine** subflow evaluates every Injection's trigger against the current `InjectionContext`
2. Matched instructions append their `prompt` text to the system-prompt slot (or messages slot, per `slot`)
3. The three API slots consume the active injections (Skills also contribute tools)
4. Tool results land in `ctx.lastToolResult`, which the next iteration's predicates can read

## Reacting to tool results

There is no separate "decision scope" to mutate — predicates read the live `InjectionContext`, and the most recent tool result is right there on `ctx.lastToolResult`. An instruction that should fire *after* a specific tool runs simply checks it:

```typescript
// Fires on the iteration AFTER the LLM called redact_pii — naturally
// one-shot, since the next iteration's lastToolResult is different.
const postPii = defineInstruction({
  id: 'post-pii',
  description: 'Reminder to use the redacted text, not the original.',
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'Use the redacted text in your reply. Do not paraphrase the original.',
});
```

The flow:
1. The LLM calls `redact_pii`; its result lands in `ctx.lastToolResult`
2. Next iteration: `post-pii` activates because `ctx.lastToolResult.toolName === 'redact_pii'`
3. That iteration's system prompt now includes the reminder

> **Triggering on a tool by name?** You can also build the Injection directly with an `on-tool-return` trigger (`{ kind: 'on-tool-return', toolName }`, where `toolName` is a string or `RegExp`) — that's the lower-level form of the `lastToolResult` predicate above.

## Always-on rules — use Steering, not a conditional instruction

For compliance, content policy, and other rules that **must** fire on every iteration, don't write a predicate at all — use `defineSteering`, which is always-on:

```typescript
import { defineSteering } from 'agentfootprint';

const compliance = defineSteering({
  id: 'compliance',
  prompt: 'GDPR compliance required. Never expose raw PII in your final answer.',
});

agent.steering(compliance);
```

A conditional instruction fires only when its `activeWhen` returns `true`, and **a predicate that throws is fail-OPEN** — the instruction is *skipped*, not forced on. So a rule you can never afford to miss should not depend on a predicate that could throw; making it always-on (Steering, or `defineInstruction` with no `activeWhen`) is the safe choice.

> **Audit which injections fired:** attach `ContextRecorder` (or call `contextEngineering(agent)`) and listen for the `agentfootprint.context.evaluated` event. It reports, per iteration, which injections were active and which were `skipped` (with `reason: 'predicate-threw'` and the error). This is what auditors will ask for; wire it before you ship.

## One predicate, four trigger kinds

There's a single predicate hook — `activeWhen(ctx)` — reading the read-only `InjectionContext`. The factory translates your options into one of the four underlying `InjectionTrigger` kinds:

| You write | Underlying trigger | Activates when |
|-----------|--------------------|----------------|
| `defineInstruction({ activeWhen })` | `{ kind: 'rule', activeWhen }` | predicate returns `true` this iteration |
| `defineInstruction({})` (no `activeWhen`) | `{ kind: 'always' }` | every iteration (consider `defineSteering` instead) |
| direct `Injection` with `on-tool-return` | `{ kind: 'on-tool-return', toolName }` | a tool matching `toolName` (string/RegExp) just returned |
| `defineSkill(...)` | `{ kind: 'llm-activated', viaToolName }` | the LLM called the skill's activation tool |

Keeping one predicate name means the signature is always `(ctx: InjectionContext) => boolean` — you never have to remember which shape applies where.

## Key Design Decisions

- **Text injection, two slots** — an instruction lands in the system-prompt slot (default) or the messages slot (`slot: 'messages'`); use `defineSkill` to unlock tools
- **InjectionContext, not full scope** — bounded read-only iteration state for clarity, debug, and eval
- **Visible in narrative** — the InjectionEngine is a footprintjs subflow, so it appears in the trace
- **Sugar over one primitive** — `defineInstruction` / `defineSteering` / `defineSkill` / `defineFact` all produce the same `Injection` shape
