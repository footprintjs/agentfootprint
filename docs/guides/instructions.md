# Instructions — Conditional Context Injection

> **The hook:** some rules should only apply *sometimes*. An instruction lets you say "when X is true, tell the LLM Y, and give it tools Z." Plain prompts can't do that — they're always on. Instructions are the conditional layer.

Instructions inject the right context at the right position at the right time into the LLM's context window. A single instruction can inject into all 3 LLM API positions: system prompt, tools, and tool-result recency window.

**Background:** the activate-when-condition-holds pattern is essentially **production rules** (forward-chaining rule systems — Newell 1973, OPS5, Rete networks) applied to LLM context. The "Decision Scope" is a bounded **belief state** (the dialog-state-tracking literature — Williams et al. 2016 — uses the same idea). What's specific here is the three-position injection: a single rule fires, but its consequences land in three different LLM API slots.

## Defining an Instruction

```typescript
import { defineInstruction, Agent, AgentPattern } from 'agentfootprint';

interface MyDecision {
  orderStatus: 'pending' | 'denied' | null;
  riskLevel: 'low' | 'high' | 'unknown';
}

const refundInstruction = defineInstruction<MyDecision>({
  id: 'refund-handling',

  // Activate when decision scope matches
  activeWhen: (d) => d.orderStatus === 'denied',

  // Position 1: Inject into system prompt
  prompt: 'Handle denied orders with empathy. Follow refund policy.',

  // Position 2: Inject tools into the tools list
  tools: [processRefund, getTrace],

  // Position 3: Rules evaluated against tool results (recency window)
  onToolResult: [
    { id: 'empathy', text: 'Do NOT promise reversal.' },
  ],
});
```

## Attaching to an Agent

```typescript
const agent = Agent.create({ provider })
  .system('You are a customer support agent.')
  .tool(lookupOrder)
  .instruction(refundInstruction)           // singular
  .instructions([compliance, adminAccess])  // plural
  .decision<MyDecision>({ orderStatus: null, riskLevel: 'unknown' })
  .pattern(AgentPattern.Dynamic)            // re-evaluate each iteration
  .build();
```

## How It Works

```
Seed (initializes decision scope)
  → [InstructionsToLLM]     evaluates activeWhen(decision) → outputs 3 injections
  → [SystemPrompt]          base prompt + promptInjections
  → [Messages]              unchanged
  → [Tools]                 base tools + toolInjections
  → AssemblePrompt → CallLLM → ParseResponse → RouteResponse
      └── tool-calls → [ExecuteTools] applies onToolResult rules
  → loopTo (Dynamic: back to InstructionsToLLM)
```

Each iteration in Dynamic mode:
1. **InstructionsToLLM** subflow evaluates all instructions against the current Decision Scope
2. Matched instructions inject their `prompt`, `tools`, and `onToolResult` rules
3. The 3 API slots consume the injections
4. Tool results can update the Decision Scope via `decide()`

## Decision Scope

The Decision Scope is a bounded set of variables that drive instruction activation. Tools update it via the `decide` field:

```typescript
const classifyInstruction = defineInstruction({
  id: 'classifier',
  onToolResult: [{
    id: 'classify-order',
    decide: (decision, ctx) => {
      decision.orderStatus = ctx.content.status;
      decision.riskLevel = ctx.content.amount > 1000 ? 'high' : 'low';
    },
  }],
});
```

The flow:
1. Tool returns `{ status: 'denied', amount: 5000 }`
2. `decide()` sets `decision.orderStatus = 'denied'`
3. Next iteration: `refund-handling` instruction activates (orderStatus is 'denied')
4. System prompt now includes empathy guidance, refund tools become available

## Safety Instructions — Fail-Closed Rules

For compliance, content policy, and other rules that **must** fire even when something goes wrong, mark an instruction as `safety: true`.

```typescript
defineInstruction({
  id: 'compliance',
  safety: true,  // fail-closed: fires when activeWhen throws
  activeWhen: (d) => d.region === 'eu',
  prompt: 'GDPR compliance required.',
});
```

Safety instructions:
- Cannot be suppressed by overrides
- Predicate throws → instruction fires (fail-closed) — **the opposite of regular instructions, which silently miss on a throw**
- Sorted LAST in the output list, which gives them the highest priority position in the assembled prompt

> **Audit which safety instructions fired:** attach `InstructionRecorder` (from `agentfootprint/instructions`). It records every instruction evaluation — which fired, which were suppressed, which threw. This is what auditors will ask for; wire it before you ship.

## Three Naming Conventions

Three predicate hooks with three different names — chosen so the signatures don't collide and so it's obvious from the call site what each one reads:

| Level | Predicate | Reads | Lives on |
|-------|-----------|-------|---|
| Agent-level | `activeWhen(decision)` | Decision Scope | `defineInstruction({ activeWhen })` |
| Tool-level | `when(ctx)` | Tool result context | `onToolResult: [{ when }]` |
| Bridge | `decide(decision, ctx)` | Both — writes Decision Scope from tool ctx | `onToolResult: [{ decide }]` |

A single shared name would force readers to remember which signature applies where. Keeping the three names lets the signature tell you what's available.

## Key Design Decisions

- **One concept, three positions** — a single instruction spans system prompt, tools, and tool results
- **Decision Scope, not full scope** — bounded variables for clarity, debug, and eval
- **Visible in narrative** — InstructionsToLLM is a footprintjs subflow, appears in BTS
- **No tiers** — `prompt`, `tools`, `onToolResult` are optional fields, fill in what you need
