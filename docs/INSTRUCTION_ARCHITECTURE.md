# Instruction Architecture

## Vision

**"Inject the right context at the right position at the right time."**

Instructions are the single concept that spans all 3 LLM API positions:
- **System prompt** — high-level behavioral instruction
- **Tools** — capability instruction (what the LLM can do)
- **Tool response** — contextual instruction (guidance based on what just happened)

No competitor has a unified concept across all three. LangGraph has 3 separate mechanisms. Strands has Skills (partial). Anthropic has raw primitives.

agentfootprint has **Instruction** — one concept, three positions.

## Current State (Phase 1 — Tool Response Only)

Instructions are co-located with tool definitions and fire after a tool returns a result.
They are appended as text to the tool result content — landing in the LLM's recency
window where it pays the most attention.

### The Instruction Type

```typescript
interface Instruction<T = unknown> {
  /** Unique ID — used by InstructionRecorder and overrides. */
  id: string;

  /** Condition: does this instruction apply to this result? Omit = always fires. */
  when?: (ctx: InstructionContext<T>) => boolean;

  /** Text guidance — appended to tool result. The LLM reads this literally. */
  text?: string;

  /** Structured follow-up — framework formats as string telling LLM which tool to call next. */
  followUp?: FollowUp<T>;

  /** Safety flag — positioned last in recency (highest attention). Never truncated. */
  safety?: boolean;

  /** Priority for ordering when multiple instructions fire. Lower = first. */
  priority?: number;
}
```

No tiers. `text` and `followUp` are optional fields — fill in what you need.

### Text Instructions

Direct text appended to the tool result:

```typescript
{ id: 'empathy',
  when: ctx => ctx.content.denied,
  text: 'Be empathetic. Do NOT promise reversal. Offer alternatives.' }

{ id: 'timeout',
  when: ctx => ctx.error?.code === 'TIMEOUT',
  text: 'Service timed out. Apologize and suggest trying again.' }

{ id: 'pii', safety: true,
  when: ctx => ctx.content.hasPII,
  text: 'Contains PII. Do NOT repeat raw values to user.' }
```

### FollowUp Instructions

Structured data — the framework formats it as a string telling the LLM which tool
to call next and with what parameters:

```typescript
{ id: 'trace',
  when: ctx => ctx.content.traceId,
  followUp: {
    toolId: 'get_trace',
    params: ctx => ({ traceId: ctx.content.traceId }),
    description: 'Get detailed denial reasoning',
  }
}
```

Becomes this string in the tool response:
```
[Follow-up: Get detailed denial reasoning — call get_trace with {"traceId":"abc-789"}]
```

If `get_trace` doesn't exist in the tools API, the LLM tries to call it and gets
"tool not found" — which is the correct behavior. No store, no TTL, no reconciliation.

### Combined (Text + FollowUp)

```typescript
{ id: 'flagged',
  when: ctx => ctx.content.flagged,
  text: 'Order flagged for fraud. Do NOT confirm shipment.',
  followUp: {
    toolId: 'get_fraud_report',
    params: ctx => ({ orderId: ctx.content.orderId }),
    description: 'View fraud analysis report',
  }
}
```

### Attaching Instructions to Tools

```typescript
const lookupOrder = defineTool({
  id: 'lookup_order',
  description: 'Look up order by ID',
  inputSchema: { ... },
  handler: async (input) => { ... },
  instructions: [
    { id: 'empathy', when: ctx => ctx.content.denied,
      text: 'Be empathetic. Offer alternatives.' },
    { id: 'trace', when: ctx => ctx.content.traceId,
      followUp: follow('get_trace', ctx => ({ traceId: ctx.content.traceId }), 'Get details') },
  ],
});
```

### How It Works at the LLM API Level

```
LLM API call:
{
  system: "You are a support agent.",          ← Position 1
  tools: [lookup_order, get_trace, ...],       ← Position 2 (always present)
  messages: [
    user: "Check order 123",
    assistant: [tool_use: lookup_order(123)],
    user: [tool_result:                        ← Position 3 (recency window)
      '{"orderId":"123","status":"denied","traceId":"abc-789"}'
      + '\n\nBe empathetic. Offer alternatives.'
      + '\n[Follow-up: Get details — call get_trace with {"traceId":"abc-789"}]'
    ]
  ]
}
```

The instruction text sits IN the tool result content. The LLM reads it in the
recency window — the position with the highest attention.

### The `follow()` Shorthand

```typescript
import { follow } from 'agentfootprint';

// Instead of writing the full FollowUp object:
followUp: {
  toolId: 'get_trace',
  params: ctx => ({ traceId: ctx.content.traceId }),
  description: 'Get denial details',
}

// Use the shorthand:
followUp: follow('get_trace', ctx => ({ traceId: ctx.content.traceId }), 'Get denial details')
```

## Phase 2 — Full Context Injection (Future)

Phase 2 extends instructions to ALL 3 LLM API positions:

```typescript
const refundInstruction = defineInstruction({
  id: 'refund-handling',

  // Position 1: System prompt injection
  prompt: 'You are trained in refund processing. Follow company policy.',

  // Position 2: Tool API injection
  tools: [lookupOrder, processRefund, getTrace],

  // Position 3: Tool response enrichment
  onToolResult: [
    { id: 'empathy', when: ctx => ctx.content.denied,
      text: 'Be empathetic. Offer alternatives.' },
    { id: 'trace', when: ctx => ctx.content.traceId,
      followUp: follow('get_trace', ctx => ({ traceId: ctx.content.traceId }), 'Get details') },
  ],
});

Agent.create({ provider })
  .instruction(refundInstruction)
  .instruction(shippingInstruction)
  .build();
```

Phase 2 design decisions (in progress):
- Instructions as flowchart stages (visible in narrative/BTS)
- Progressive disclosure (lazy-load full instruction on demand)
- Instruction overrides at agent level
- Dynamic conditions evaluated per turn

## Competitive Landscape

| Framework | System Prompt | Tools | Tool Response | Unified Concept |
|-----------|--------------|-------|---------------|-----------------|
| Anthropic API | manual | manual | manual | None |
| LangGraph | middleware | bind_tools | wrap_tool_call | None (3 mechanisms) |
| Strands | XML injection | @tool | ToolResult | Skills (partial) |
| **agentfootprint** | PromptProvider | ToolProvider | Instruction | **Instruction** (unified) |

## Design Principles

1. **Instructions are strings.** The LLM reads text. Everything becomes a string.
2. **Instructions are co-located.** Attached to tools, not scattered in config files.
3. **Instructions are conditional.** `when` predicate makes them dynamic.
4. **Instructions are observable.** They show up in the narrative trace.
5. **Instructions work with ANY tool.** footprintjs-built, MCP, third-party.
6. **No tiers.** `text` and `followUp` are optional fields. Fill in what you need.
7. **FollowUp is a string, not a store.** If the tool exists, LLM calls it. If not, "not found" error.
