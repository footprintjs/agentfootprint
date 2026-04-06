# instructions/

Conditional context injection across all 3 LLM API positions.

## Why

A single concept ("Instruction") spans system prompt, tools, and tool-result recency window. No competitor has this. LangGraph needs 3 separate mechanisms. Strands has Skills (partial).

## Usage

```typescript
import { defineInstruction, Agent } from 'agentfootprint';

const instr = defineInstruction({
  id: 'refund',
  activeWhen: (d) => d.orderStatus === 'denied',
  prompt: 'Be empathetic.',
  tools: [processRefund],
  onToolResult: [{ id: 'empathy', text: 'Do NOT promise reversal.' }],
});

Agent.create({ provider }).instruction(instr).decision({ orderStatus: null }).build();
```

## API

| Export | Type | Description |
|--------|------|-------------|
| `defineInstruction<T>()` | Factory | Create a validated AgentInstruction |
| `AgentInstruction<T>` | Type | Agent-level instruction with `activeWhen`, `prompt`, `tools`, `onToolResult` |
| `evaluateAgentInstructions()` | Function | Evaluate instructions against Decision Scope |
| `buildInstructionsToLLMSubflow()` | Function | Build the InstructionsToLLM footprintjs subflow |
| `LLMInstruction<T>` | Type | Tool-level instruction with `when`, `text`, `followUp`, `decide` |
| `InstructionEvaluationResult` | Type | Output: promptInjections, toolInjections, responseRules, matchedIds |
| `AgentScopeKey` | Enum | Type-safe scope key references for grounding analysis |

## See Also

- [Instructions Guide](../../../docs/guides/instructions.md)
- [Design Proposal](../../../docs/DESIGN_PROPOSAL_InstructionsToLLM.md)
