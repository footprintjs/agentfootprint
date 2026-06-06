# Instruction Architecture

## Vision

**"Inject the right context at the right position at the right time."**

Instructions are the single concept that spans all 3 LLM API positions:
- **System prompt** — high-level behavioral instruction
- **Tools** — capability instruction (what the LLM can do)
- **Tool response** — contextual instruction (guidance based on what just happened)

No competitor has a unified concept across all three. LangGraph has 3 separate mechanisms. Strands has Skills (partial). Anthropic has raw primitives.

agentfootprint has **Injection** — one primitive, three positions, with typed sugar
factories (`defineInstruction`, `defineSkill`, `defineSteering`, `defineFact`).

## The Unifying Primitive — `Injection`

Under the hood there is **one** primitive — `Injection` — and a set of typed sugar
factories that produce it: `defineInstruction`, `defineSkill`, `defineSteering`,
`defineFact`. Every flavor lands content into one of the three LLM API positions
(system prompt, tools, messages) according to its `inject` shape, and activates
according to its `trigger`. You import the factories from `agentfootprint` (or the
`agentfootprint/injection-engine` subpath).

```typescript
import {
  defineInstruction,
  defineSkill,
  defineSteering,
  defineFact,
} from 'agentfootprint';
```

### Rule-based Instructions — `defineInstruction`

A predicate (`activeWhen`) decides activation each iteration. The `prompt` text lands
in the system-prompt slot by default, or the messages slot (higher attention) via
`slot: 'messages'`. Omit `activeWhen` and the instruction is always active.

```typescript
const empathy = defineInstruction({
  id: 'empathy',
  description: 'Use a calm, empathetic tone with frustrated users.',
  activeWhen: (ctx) => /upset|angry|frustrated/.test(ctx.userMessage),
  prompt: 'Acknowledge feelings before facts. Avoid corporate jargon.',
});

const postRedact = defineInstruction({
  id: 'pii-after-redact',
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'PII has been redacted. Do not repeat emails or phone numbers.',
  slot: 'messages',   // recency window — highest attention
  role: 'system',
});
```

`DefineInstructionOptions`: `{ id, prompt, description?, activeWhen?, slot?, role?, cache? }`.
The `activeWhen` predicate receives an `InjectionContext` — `{ iteration, userMessage,
history, lastToolResult?, activatedInjectionIds }` — NOT the raw tool payload. Branch
on `ctx.lastToolResult` for the "react to what just happened" pattern.

### Always-on Steering — `defineSteering`

Invariant guidance with no predicate — appended to the system prompt every iteration.

```typescript
const tone = defineSteering({
  id: 'tone',
  prompt: 'Always respond in a concise, professional tone.',
});
```

`DefineSteeringOptions`: `{ id, prompt, description?, cache? }`.

### Developer-supplied Facts — `defineFact`

Data the LLM should see — user profile, env info, computed summary, current time.

```typescript
const profile = defineFact({
  id: 'user-profile',
  data: 'User is a Gold-tier customer since 2021.',
  slot: 'messages',
});
```

`DefineFactOptions`: `{ id, data, description?, slot?, role?, activeWhen?, cache? }`.

### Tool-unlocking Skills — `defineSkill`

A Skill is the one flavor that spans BOTH system prompt AND tools: when activated, its
`body` lands in the system slot and its `tools` are added to the tools slot. The LLM
activates a Skill on demand by calling `read_skill` (the `'llm-activated'` trigger).

```typescript
const refundSkill = defineSkill({
  id: 'refunds',
  description: 'Process customer refunds per policy.',
  body: 'You are trained in refund processing. Follow company policy.',
  tools: [lookupOrder, processRefund, getTrace],
});
```

`DefineSkillOptions`: `{ id, description, body, tools?, viaToolName?, surfaceMode?,
refreshPolicy?, ... }`.

### Registering on an Agent

All four flavors register on the builder the same way — `.instruction(injection)`
(or `.instructions([...])` to bulk-register), plus `.steering(...)` and `.fact(...)`
aliases for clearer intent:

```typescript
import { Agent } from 'agentfootprint';

const agent = Agent.create({ provider })
  .instruction(empathy)
  .instruction(postRedact)
  .steering(tone)
  .fact(profile)
  .skill(refundSkill)
  .build();
```

### How It Works at the LLM API Level

Each active injection lands content into the LLM request according to its `inject`
shape. An always-on steering doc and a `slot: 'system-prompt'` instruction append to
`system`; a Skill's `tools` extend `tools`; a `slot: 'messages'` instruction or fact
appends to `messages` in the recency window.

```
LLM API call:
{
  system: "You are a support agent."           ← Position 1
        + "\nAcknowledge feelings before facts.",   (defineInstruction → system slot)
  tools: [lookup_order, get_trace, ...],        ← Position 2 (Skill tools land here)
  messages: [
    user: "Check order 123",
    assistant: [tool_use: lookup_order(123)],
    user: [tool_result: '{"orderId":"123","status":"denied"}'],
    user: "PII has been redacted. Do not repeat emails." ← Position 3 (slot: 'messages')
  ]
}
```

The messages slot is the recency window — the position with the highest attention.
Use `slot: 'messages'` for guidance that MUST be salient on this turn (post-tool-result
reminders, urgent corrections).

### Reacting to a tool result

The "react to what just happened" pattern is expressed two ways:

- **`defineInstruction` with `activeWhen: (ctx) => ctx.lastToolResult?.toolName === '…'`** —
  a rule-based instruction that fires the iteration after a specific tool ran.
- **Raw `Injection` with `trigger: { kind: 'on-tool-return', toolName }`** — the
  engine-native trigger that fires when a matching tool returns (the "Dynamic ReAct"
  pattern). `defineSkill` uses the related `'llm-activated'` trigger.

Activation is observable: each evaluation emits `agentfootprint.context.injected`
/ `agentfootprint.context.evaluated` on the emit channel, and instructions show up in
the narrative trace as injection-engine stages.

## Competitive Landscape

| Framework | System Prompt | Tools | Tool Response | Unified Concept |
|-----------|--------------|-------|---------------|-----------------|
| Anthropic API | manual | manual | manual | None |
| LangGraph | middleware | bind_tools | wrap_tool_call | None (3 mechanisms) |
| Strands | XML injection | @tool | ToolResult | Skills (partial) |
| **agentfootprint** | defineInstruction / defineSteering | defineSkill / ToolProvider | defineInstruction (`activeWhen: lastToolResult`) / `on-tool-return` | **Injection** (unified) |

## Design Principles

1. **One primitive.** Every flavor is an `Injection`. The factories are sugar — they
   only differ in their default `trigger` and `inject` shape.
2. **Injections are strings.** The LLM reads text. `prompt` / `body` / `data` are text.
3. **Injections are conditional.** `activeWhen` predicate (or `trigger`) makes them dynamic.
4. **Injections are observable.** They show up in the narrative trace and emit
   `agentfootprint.context.injected` / `agentfootprint.context.evaluated`.
5. **Skills unlock tools.** `defineSkill` is the one flavor that spans system prompt
   AND tools — the LLM activates it on demand via `read_skill`.
6. **Choose by intent.** `defineSteering` (always-on), `defineInstruction` (rule-based),
   `defineFact` (data), `defineSkill` (tool-unlocking). Same primitive, clearer code.
