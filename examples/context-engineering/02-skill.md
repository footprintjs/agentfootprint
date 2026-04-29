---
name: Skill — LLM-activated body + tools
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: I need a refund for order #42
---

# Skill — LLM-activated body + tools

A Skill is the **`llm-activated`** flavor of Injection — the LLM itself
decides when to load the Skill's content. Once it calls
`read_skill('billing')`, the Skill's body appends to the next iteration's
system prompt AND its declared tools become available in the tools slot.

This is the *Anthropic Skills / OpenAI Plugin* pattern, made first-class
in agentfootprint and uniform with every other context-engineering
flavor.

## When to use

- **Domain expertise that's expensive to always include** — billing
  rules, legal compliance text, troubleshooting playbooks
- **Tool gating** — sensitive tools (refund, delete-account) only
  activate when the LLM has explicitly asked for the Skill that
  supplies them
- **Disambiguation** — multi-domain agents where different problems
  need different bodies of knowledge

## How it works

```
Turn starts (agent.run({ message: '...' }))
  ↓
Iteration 1
  ┌─ InjectionEngine evaluates triggers:
  │   - billingSkill (llm-activated): id NOT in activatedInjectionIds → silent
  ├─ tools slot exposes read_skill (auto-attached) + any registered tools
  └─ LLM sees billingSkill in the read_skill catalog (description), decides
     to call read_skill('billing')

Tool exec
  - Agent intercepts read_skill call
  - scope.activatedInjectionIds += ['billing']

Iteration 2
  ┌─ InjectionEngine evaluates:
  │   - billingSkill: 'billing' IS in activatedInjectionIds → ACTIVE
  ├─ system-prompt slot: base + billingSkill.body          ← NEW
  ├─ tools slot: read_skill + (anything from .tool()) + process_refund  ← NEW
  └─ LLM now has body of billing knowledge + the refund tool
```

Skill stays active until the turn ends. Next turn (`agent.run()` again)
starts fresh — `activatedInjectionIds` resets to `[]`.

## Key API

```ts
import { Agent, defineSkill, defineTool } from 'agentfootprint';

const refundTool = defineTool({
  name: 'process_refund',
  description: 'Issue a refund.',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  execute: ({ orderId }) => `refunded ${orderId}`,
});

const billingSkill = defineSkill({
  id: 'billing',
  description: 'Use for refunds / charges. The LLM reads this when deciding.',
  body: 'When handling billing: confirm the order id first, then process.',
  tools: [refundTool],
});

const agent = Agent.create({ provider, model: 'mock' })
  .skill(billingSkill)
  .build();
// Auto-attaches `read_skill` tool to the agent.
```

## What it emits

- `agentfootprint.context.evaluated` — engine reports `billing` activation
- `agentfootprint.context.injected` (system-prompt) — `source: 'skill'`,
  `sourceId: 'billing'`
- `agentfootprint.context.injected` (tools) — one per Skill-supplied tool,
  also `source: 'skill'`
- `agentfootprint.stream.tool_start` / `tool_end` for `read_skill`

## Tool name uniqueness

Tool names must be unique across `.tool()` registrations and every
Skill's `inject.tools[]`. Names are the LLM's wire-format dispatch key
(no ids in the wire format). The Agent throws at `build()` on collision.

## Related

- **[Instruction](./01-instruction.md)** — rule-based, predicate decides
- **[Steering](./03-steering.md)** — always-on (every iteration)
- **[Mixed flavors](./06-mixed-flavors.md)** — Skills + Steering + Facts
  in one agent
