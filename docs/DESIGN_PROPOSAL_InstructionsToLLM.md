# Design Proposal: InstructionsToLLM — Context Injection Architecture

**Author:** Sanjay Krishna Anbalagan  
**Date:** April 2026  
**Status:** Proposal — Pending Review  

---

## 1. Problem Statement

AI agents need to inject the right context at the right position at the right time into the LLM's context window. Today's frameworks handle this with scattered, disconnected mechanisms:

- **LangGraph:** Three separate mechanisms (middleware for prompts, bind_tools for tools, wrap_tool_call for responses). No unified concept.
- **Strands:** Skills concept bundles prompt + tools, but Skills are Anthropic/MCP terminology and don't cover tool response enrichment.
- **Anthropic API:** Raw primitives (system, tools, messages params). Developer manages everything manually.

**The gap:** No framework has a single concept that spans all three LLM API input positions (system prompt, tools, messages) with conditional injection driven by accumulated conversation state.

---

## 2. LLM API Foundation

Every LLM API call has exactly three input surfaces:

```
POST /v1/messages
{
  system: "...",              ← Position 1: System prompt (behavioral instructions)
  tools: [...],               ← Position 2: Tool descriptions (capability instructions)  
  messages: [                 ← Position 3: Conversation (contextual instructions)
    { role: "user", content: "..." },
    { role: "assistant", content: "...", tool_use: [...] },
    { role: "user", content: [{ type: "tool_result", content: "..." }] }
  ]
}
```

**Key properties:**
- `system` is re-sent every call. Always position 0 in the LLM's attention.
- `tools` is re-sent every call. Separate parameter, never windowed out.
- `messages` is the conversation. Subject to windowing (old messages trimmed).
- Tool results sit in `messages` — highest recency, highest attention weight.

Everything we add to these three positions is an **instruction to the LLM**.

---

## 3. Proposed Architecture

### 3.1 Core Concepts

**Decision Scope** — Developer-defined state variables that accumulate across the conversation. Tools UPDATE these variables in their handlers. Instructions READ them to decide what to inject.

```typescript
interface MyDecisionScope {
  userVerified: boolean;
  orderStatus: 'pending' | 'shipped' | 'denied' | null;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  region: 'us' | 'eu' | 'apac';
}
```

**Instruction** — A conditional injection rule that specifies WHAT to inject and WHERE, based on the Decision Scope:

```typescript
const refundInstruction = defineInstruction({
  id: 'refund-handling',
  when: (scope: MyDecisionScope) => scope.orderStatus === 'denied',
  
  // Position 1: Inject into system prompt
  prompt: 'You are handling a denied order. Follow refund policy. Be empathetic.',
  
  // Position 2: Inject into tools list  
  tools: [processRefund, getTrace, askHuman],
  
  // Position 3: Inject into tool responses (recency window)
  onToolResult: [
    { id: 'empathy', text: 'Be empathetic. Do NOT promise reversal.' },
    { id: 'trace',
      followUp: { toolId: 'get_trace', params: ctx => ({ traceId: ctx.content.traceId }),
                  description: 'Get denial details' } },
  ],
});
```

**InstructionsToLLM** — A subflow that runs BEFORE the three API slots. Evaluates all registered instructions against the current Decision Scope. Outputs categorized injections for each slot to consume.

### 3.2 Agent Loop (Updated)

```
Seed (initialize Decision Scope)
  │
  ▼
[InstructionsToLLM subflow]          ← NEW
  │  Reads: Decision Scope + instruction registry
  │  Evaluates: when(scope) for each instruction
  │  Outputs: {
  │    promptInjections: string[],
  │    toolInjections: ToolDefinition[],
  │    responseRules: OnToolResultRule[],
  │  }
  │
  ├──▶ [SystemPrompt slot]          ← reads promptInjections
  │      Base prompt + matched instruction prompts merged
  │
  ├──▶ [Messages slot]              ← unchanged (message strategy)
  │
  ├──▶ [Tools slot]                 ← reads toolInjections
  │      Base tools + matched instruction tools merged
  │
  ▼
  AssemblePrompt → CallLLM → ParseResponse
  │
  ▼
  RouteResponse
  ├── tool-calls → [ExecuteTools]
  │     │  Tool handler UPDATES Decision Scope
  │     │  responseRules evaluated against tool result
  │     │  Matching rules: text + followUp appended to tool result content
  │     │
  │     └──▶ loopTo (Dynamic: back to InstructionsToLLM)
  │
  └── final → Finalize
```

### 3.3 How Tools Update Decision Scope

```typescript
const lookupOrder = defineTool({
  id: 'lookup_order',
  description: 'Look up order by ID',
  inputSchema: { ... },
  handler: async (input, scope: MyDecisionScope) => {
    const order = await db.orders.findById(input.orderId);
    
    // UPDATE Decision Scope — drives instruction injection next iteration
    scope.orderStatus = order.status;
    scope.riskLevel = order.amount > 1000 ? 'high' : 'low';
    
    return { content: JSON.stringify(order) };
  },
});
```

### 3.4 How Slots Read Instruction Outputs

**SystemPrompt slot:**
```
Base prompt (from PromptProvider):
  "You are a customer support agent for TechStore."

+ Matched instruction prompts (from InstructionsToLLM):
  "You are handling a denied order. Follow refund policy. Be empathetic."
  "COMPLIANCE: EU region requires GDPR-compliant responses."

= Final system prompt sent to LLM
```

**Tools slot:**
```
Base tools (from ToolProvider):
  [lookup_order, check_inventory, track_package]

+ Matched instruction tools (from InstructionsToLLM):
  [processRefund, getTrace, askHuman]

= Full tools array sent to LLM
```

**Tool response (in messages):**
```
Tool result: {"orderId":"123","status":"denied","traceId":"abc-789"}

+ Matched response rules (from InstructionsToLLM):
  "Be empathetic. Do NOT promise reversal."
  "[Follow-up: Get denial details — call get_trace with {"traceId":"abc-789"}]"

= Enriched tool result content in messages
```

### 3.5 Multi-Turn Example

```
Turn 1:
  Decision Scope: { userVerified: false, orderStatus: null, riskLevel: 'unknown', region: 'us' }
  InstructionsToLLM: no instructions match → base prompt + base tools
  LLM calls lookup_order → handler sets orderStatus='denied', riskLevel='high'
  Tool response: empathy text + trace followUp injected
  
  → Loop back to InstructionsToLLM (Dynamic pattern)

Turn 2:  
  Decision Scope: { userVerified: false, orderStatus: 'denied', riskLevel: 'high', region: 'us' }
  InstructionsToLLM: refund-handling matches! high-risk matches!
    promptInjections: ["Handle denied orders with empathy.", "High-risk: require approval."]
    toolInjections: [processRefund, getTrace, askHuman]
  SystemPrompt: base + refund prompt + high-risk prompt
  Tools: base + refund tools + askHuman
  LLM sees updated context → calls askHuman for manager approval

Turn 3:
  Decision Scope: { userVerified: true, orderStatus: 'denied', riskLevel: 'high', region: 'us' }
  InstructionsToLLM: refund-handling + high-risk + admin-access all match!
    toolInjections now includes admin tools
  LLM sees admin capabilities → can override policy if manager approved
```

---

## 4. API Design

### 4.1 Defining Instructions

```typescript
import { defineInstruction, follow } from 'agentfootprint';

const refundInstruction = defineInstruction({
  id: 'refund-handling',
  description: 'Handles denied order refund flow',
  
  // Condition: when does this instruction activate?
  when: (scope) => scope.orderStatus === 'denied',
  
  // What to inject at each position
  prompt: 'You are handling a denied order. Be empathetic. Follow refund policy.',
  tools: [processRefund, getTrace],
  onToolResult: [
    { id: 'empathy', text: 'Be empathetic. Do NOT promise reversal.' },
    { id: 'trace', when: ctx => ctx.content.traceId,
      followUp: follow('get_trace', ctx => ({ traceId: ctx.content.traceId }), 'Get details') },
  ],
});
```

### 4.2 Using Instructions in an Agent

```typescript
const agent = Agent.create({ provider })
  .decision<MyDecision>({
    userVerified: false,
    orderStatus: null,
    riskLevel: 'unknown',
  })
  .instructionToLLM(refundInstruction)
  .instructionToLLM(complianceInstruction)
  .instructionToLLM(adminInstruction)
  .tool(lookupOrder)
  .tool(verifyUser)
  .pattern(AgentPattern.Dynamic)
  .build();
```

### 4.3 The Instruction Type

```typescript
interface Instruction<TScope = any, TToolResult = unknown> {
  readonly id: string;
  readonly description?: string;
  
  /** Condition: activate when Decision Scope matches. Omit = always active. */
  readonly when?: (scope: TScope) => boolean;
  
  /** Position 1: Text merged into system prompt. */
  readonly prompt?: string;
  
  /** Position 2: Tools added to the tools list. */
  readonly tools?: ToolDefinition[];
  
  /** Position 3: Rules evaluated against tool results, appended to tool response. */
  readonly onToolResult?: OnToolResultRule<TToolResult>[];
}

interface OnToolResultRule<T = unknown> {
  readonly id: string;
  readonly when?: (ctx: InstructionContext<T>) => boolean;
  readonly text?: string;
  readonly followUp?: FollowUp<T>;
  readonly safety?: boolean;
}
```

### 4.4 FollowUp Format

FollowUp is structured data that the framework formats as a string in the tool response:

```typescript
interface FollowUp<T = unknown> {
  readonly toolId: string;
  readonly params: (ctx: InstructionContext<T>) => Record<string, unknown>;
  readonly description: string;
  readonly condition?: string;
  readonly strict?: boolean;
}

// Shorthand
function follow<T>(toolId: string, params: (ctx: InstructionContext<T>) => Record<string, unknown>, description: string): FollowUp<T>;
```

The formatted string in the tool response:
```
[Follow-up: Get denial details — call get_trace with {"traceId":"abc-789"}]
```

If the tool doesn't exist in the tools API, the LLM tries to call it and gets "tool not found" — correct behavior. No separate store or reconciliation needed.

---

## 5. InstructionsToLLM Subflow Design

### 5.1 Internal Stages

```
[LoadInstructions]
  Read all registered instructions from the instruction registry.

[EvaluateConditions]  
  For each instruction, evaluate when(decisionScope).
  Collect matched instructions.

[ClassifyOutputs]
  Group matched instructions by target position:
    - promptInjections: instruction.prompt texts
    - toolInjections: instruction.tools arrays (flattened)
    - responseRules: instruction.onToolResult rules

[Output]
  Write to scope: promptInjections, toolInjections, responseRules
```

### 5.2 As a footprintjs Flowchart

```typescript
const instructionsSubflow = flowChart('InstructionsToLLM', async (scope) => {
  const decisionScope = scope.decisionScope;
  const registry = scope.instructionRegistry;
  
  const promptInjections: string[] = [];
  const toolInjections: ToolDefinition[] = [];
  const responseRules: OnToolResultRule[] = [];
  
  for (const instruction of registry) {
    if (instruction.when && !instruction.when(decisionScope)) continue;
    
    if (instruction.prompt) promptInjections.push(instruction.prompt);
    if (instruction.tools) toolInjections.push(...instruction.tools);
    if (instruction.onToolResult) responseRules.push(...instruction.onToolResult);
  }
  
  scope.promptInjections = promptInjections;
  scope.toolInjections = toolInjections;
  scope.responseRules = responseRules;
}, 'instructions-to-llm').build();
```

### 5.3 Visibility in Narrative

Because InstructionsToLLM is a footprintjs subflow, it appears in the execution narrative:

```
1. [Seed] Initialized agent state
2. Evaluating instructions [→ instructions-to-llm]
   Decision Scope: { orderStatus: 'denied', riskLevel: 'high' }
   Matched: refund-handling (prompt + 2 tools + 2 response rules)
   Matched: high-risk-flow (prompt + askHuman tool)
3. [SystemPrompt] Base + 2 instruction prompts merged
4. [Tools] Base tools + 3 instruction tools merged
5. [CallLLM] ...
```

The developer can always trace: "Why did the LLM have access to processRefund?" → "Because the refund-handling instruction was active (orderStatus was 'denied')."

---

## 6. Decision Scope Design

### 6.1 Core Principle: One Scope, One Field, Clear Boundary

Decision variables live as a single `decision` field inside the agent's TypedScope.
Not a separate system — a well-defined boundary within the existing scope:

```typescript
interface MyAgentScope extends BaseLLMState {
  // Regular agent state (framework-managed)
  messages: Message[];
  loopCount: number;
  result: string;
  
  // Decision variables — THIS drives instruction activation
  decision: {
    orderStatus: 'pending' | 'denied' | null;
    riskLevel: 'low' | 'high' | 'unknown';
    userVerified: boolean;
  };
}
```

The developer knows:
- `scope.messages` — conversation state (framework-managed)
- `scope.decision` — what controls instruction activation (developer-managed)

### 6.2 Why a `decision` Field, Not the Full Scope

- **Narrative clarity**: `decision.orderStatus → 'denied'` is a clear signal, not buried in general state
- **Debug**: look at `scope.decision` — everything that matters for instructions is right there
- **Evaluate**: compare `decision` across runs to understand why different instructions fired
- **LLM trace**: "Instruction activated because decision.riskLevel was 'high'"
- **Bounded**: developers know exactly which variables affect instruction activation

### 6.3 Lifecycle

```
Construction:  Developer defines initial decision values via .decision({...})
Seed stage:    Initial values written to scope.decision
Tool handlers: UPDATE scope.decision based on tool results
Per iteration: InstructionsToLLM READS scope.decision to evaluate conditions
Checkpoint:    scope.decision saved in FlowchartCheckpoint (pause/resume)
```

### 6.4 Instructions Read `scope.decision`

The `when` predicate receives `scope.decision` (not the full scope):

```typescript
const refundInstruction = defineInstruction({
  id: 'refund-handling',
  when: (decision) => decision.orderStatus === 'denied',
  //     ^^^^^^^^ receives scope.decision, clear and bounded
  prompt: 'Handle denied orders with empathy.',
  tools: [processRefund],
});
```

### 6.5 Tools Update `scope.decision`

Tool handlers update decision variables through the scope:

```typescript
const lookupOrder = defineTool({
  id: 'lookup_order',
  handler: async (input) => {
    const order = await db.lookup(input.orderId);
    // Clear: this drives instruction activation
    scope.decision.orderStatus = order.status;
    scope.decision.riskLevel = order.amount > 1000 ? 'high' : 'low';
    return { content: JSON.stringify(order) };
  },
});
```

---

## 7. Phased Implementation

### Phase 1 (Current Release)
- Simplify existing instruction types: `inject` → `text`, remove tier concept
- Tool response only (onToolResult)
- No InstructionsToLLM subflow
- No Decision Scope

### Phase 2 (Next Major)
- `defineInstruction()` with prompt/tools/onToolResult
- `.instructionToLLM()` on Agent builder
- InstructionsToLLM subflow before 3 slots
- Decision Scope with `.decisionScope<T>()`
- AgentPattern.Dynamic re-evaluates InstructionsToLLM each iteration

### Phase 3 (Future)
- Progressive disclosure: lazy-load instruction details on demand
- Instruction composition: instruction extends instruction
- Instruction versioning and A/B testing
- InstructionRecorder integration for observability

---

## 8. Competitive Position

| Capability | Anthropic API | LangGraph | Strands | agentfootprint |
|---|---|---|---|---|
| Dynamic system prompt | Manual | Middleware | XML per turn | InstructionsToLLM |
| Dynamic tools | Manual | bind_tools | Runtime add | InstructionsToLLM |
| Tool response enrichment | Manual | wrap_tool_call | ToolResult | InstructionsToLLM |
| Unified concept | None | None | Skills (partial) | **Instruction** |
| State-driven injection | None | InjectedState | None | **Decision Scope** |
| Injection visibility | None | None | None | **Narrative trace** |

**Unique differentiators:**
1. Single concept (Instruction) spanning all 3 LLM API positions
2. Decision Scope — accumulated state driving conditional injection
3. Visible in narrative — "Why did the LLM have that tool?" is always answerable
4. Built on footprintjs flowchart — observable, recordable, explainable

---

## 9. Review Findings (8-Expert Panel, April 2026)

### P0 — Resolved in Design

**Security: Decision Scope manipulable by LLM via tool arguments.**
Resolution: `scope.decision` values should be computed from tool RESULTS (server-side data),
not from LLM-chosen tool ARGUMENTS. The tool handler controls the computation — the LLM
cannot directly set `scope.decision.riskLevel`. The handler reads from the database/API
result, not from `input.riskLevel`.

**Context Architecture: No deactivation contract for dynamically removed tools.**
Resolution: When an instruction deactivates (condition no longer matches), its tools
are removed from the next API call. The LLM may try to call a removed tool and get
"tool not found." This is correct behavior — the tool is no longer relevant. Document
this as the explicit contract.

### P1 — To Address in Implementation

| Finding | Resolution |
|---------|-----------|
| Safety instructions unsuppressable | `safety: true` skips `suppress` overrides |
| System prompt "lost in middle" | Priority field + structured format (numbered sections) |
| Contradictory instructions | `group` field — same group, highest priority wins |
| No non-firing tracking | `onEvaluated` recorder event with predicate results |
| No token budget | Warn when injections exceed configurable threshold |
| FollowUp too directive | Non-strict: "If the user wants details, you can call..." |
| `prompt` string vs function | Accept both: `string \| ((decision) => string)` |
| Tool deduplication | Deduplicate by ID across instructions |

## 10. Open Questions

1. **Instruction ordering:** When multiple instructions match, how are their prompts ordered? By priority field? By registration order?

2. **Decision scope persistence:** Should `scope.decision` persist across conversation turns (via ConversationStore) or reset each turn?

3. **onToolResult + decision:** Should onToolResult rules read BOTH `scope.decision` (cross-tool state) AND `InstructionContext` (current tool result)?

4. **Progressive disclosure:** When to lazy-load full instruction details? How to handle the "tool_search" pattern for instructions?
