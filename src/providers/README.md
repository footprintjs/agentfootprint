# providers/

The 3 strategy slots — dynamic behavior without changing agent code.

Every agent has 3 slots that determine what happens each iteration:

| Slot | Controls | Default |
|------|----------|---------|
| **SystemPrompt** | What instructions the LLM receives | Static string from `.system()` |
| **Messages** | What conversation history the LLM sees | Full history |
| **Tools** | What tools the LLM can call | All registered tools |

Each slot is a strategy — swap the strategy, change the behavior.

## Prompt Strategies

```typescript
import { staticPrompt, templatePrompt, compositePrompt } from 'agentfootprint/providers';

// Fixed prompt
staticPrompt('You are a helpful assistant.')

// Template with variables
templatePrompt('You are a {role} assistant for {company}.')

// Compose multiple strategies
compositePrompt({ strategies: [basePrompt, contextPrompt, safetyPrompt] })
```

| Strategy | When |
|----------|------|
| `staticPrompt()` | Same prompt every time |
| `templatePrompt()` | Prompt varies by context (role, company, user) |
| `skillBasedPrompt()` | Select prompt from skill registry based on intent |
| `compositePrompt()` | Combine multiple strategies (base + context + safety) |

## Message Strategies

```typescript
import { slidingWindow, charBudget, withToolPairSafety } from 'agentfootprint/providers';

// Keep last 20 messages
slidingWindow({ maxMessages: 20 })

// Fit within token budget (~4 chars/token)
charBudget({ maxChars: 16000 })

// Preserve tool call ↔ result pairs even during truncation
withToolPairSafety(slidingWindow({ maxMessages: 20 }))
```

| Strategy | When |
|----------|------|
| `fullHistory()` | Send everything (short conversations) |
| `slidingWindow()` | Keep last N messages (most common) |
| `charBudget()` | Fit within context window |
| `withToolPairSafety()` | Wrap any strategy to preserve tool pairs |
| `summaryStrategy()` | Compress old messages into summary |
| `compositeMessages()` | Chain strategies (summarize + window) |
| `persistentHistory()` | Load/save from ConversationStore |

## Tool Strategies

```typescript
import { staticTools, dynamicTools, gatedTools } from 'agentfootprint/providers';

// Fixed tool set
staticTools([searchTool, calcTool])

// Tools vary by context
dynamicTools((context) => context.turnNumber === 0 ? [searchTool] : [searchTool, calcTool])

// Permission-gated (positional: inner provider, checker, options?)
gatedTools(staticTools(allTools), (tool, ctx) => isAllowed(tool, ctx.user))
```

| Strategy | When |
|----------|------|
| `staticTools()` | Same tools every turn |
| `dynamicTools()` | Tools vary by context/turn/state |
| `noTools()` | No tool calling |
| `gatedTools()` | Permission checks before tool use |
| `agentAsTool()` | Wrap an agent as a tool |
| `compositeTools()` | Merge multiple tool sets |

## Dynamic ReAct

In Dynamic mode (`AgentPattern.Dynamic`), ALL 3 slots re-evaluate each iteration:

```typescript
Agent.create({ provider })
  .pattern(AgentPattern.Dynamic)
  .promptProvider(myDynamicPrompt)     // re-evaluated each loop
  .toolProvider(myDynamicTools)        // re-evaluated each loop
  .memory({ strategy: slidingWindow({ maxMessages: 20 }) })  // message strategy via .memory()
  .build();
```

Combined with `defineInstruction()` from `agentfootprint/instructions`, this gives full control over what the LLM sees at each step.

## SlotDecision Pattern

Every strategy returns `{ value, chosen, rationale }` — not just the value. This is for explainability: the narrative records WHY a particular prompt/message set/tool set was chosen.
