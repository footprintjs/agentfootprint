# Instructions — Conditional Context Injection

Instructions inject the right context at the right position at the right time into the LLM's context window. A single instruction can inject into all 3 LLM API positions: system prompt, tools, and tool-result recency window.

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

## Three Naming Conventions

| Level | Predicate | Reads |
|-------|-----------|-------|
| Agent-level | `activeWhen(decision)` | Decision Scope |
| Tool-level | `when(ctx)` | Tool result context |
| Decision | `decide(decision, ctx)` | Both |

No collision — different names, different signatures.

## Safety Instructions

```typescript
defineInstruction({
  id: 'compliance',
  safety: true,  // fail-closed: fires when activeWhen throws
  activeWhen: (d) => d.region === 'eu',
  prompt: 'GDPR compliance required.',
});
```

Safety instructions:
- Cannot be suppressed
- Predicate throws → instruction fires (fail-closed)
- Sorted LAST in output (highest priority position)

## Key Design Decisions

- **One concept, three positions** — a single instruction spans system prompt, tools, and tool results
- **Decision Scope, not full scope** — bounded variables for clarity, debug, and eval
- **Visible in narrative** — InstructionsToLLM is a footprintjs subflow, appears in BTS
- **No tiers** — `prompt`, `tools`, `onToolResult` are optional fields, fill in what you need
