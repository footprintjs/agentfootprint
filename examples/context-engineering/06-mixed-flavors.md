---
name: Mixed flavors — all 4 in one agent
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: help me reset my password
---

# Mixed flavors — all 4 in one agent

The shortest possible example showing every Injection flavor side by
side. Use this as a quick reference for the API shape.

```ts
import {
  Agent,
  defineSteering,
  defineInstruction,
  defineSkill,
  defineFact,
  defineTool,
} from 'agentfootprint';

const agent = Agent.create({ provider, model: 'mock' })
  .system('You are a support assistant.')

  // Always-on
  .steering(defineSteering({ id: 'tone', prompt: 'Be friendly.' }))

  // Predicate-gated
  .instruction(defineInstruction({
    id: 'urgent',
    activeWhen: (ctx) => /urgent|asap/.test(ctx.userMessage),
    prompt: 'Prioritize fastest resolution.',
  }))

  // LLM-activated (body + tools)
  .skill(defineSkill({
    id: 'account',
    description: 'Password resets, profile updates.',
    body: 'Confirm identity before resetting.',
    tools: [defineTool({ ... })],
  }))

  // Developer-supplied facts
  .fact(defineFact({ id: 'user', data: 'User: Alice (Pro plan)' }))
  .fact(defineFact({ id: 'hours', data: 'Live agent 24/7' }))

  .build();
```

## Same primitive — different intent

| Flavor | Intent | Trigger | Slot(s) |
|---|---|---|---|
| Steering | Always-on policy | `always` | system-prompt |
| Instruction | Conditional rule | `rule` | system-prompt |
| Skill | LLM-discoverable knowledge | `llm-activated` (`read_skill`) | system-prompt + tools |
| Fact | Static data | `always` (or `rule`) | system-prompt OR messages |

All four produce the same `Injection` underneath. Same engine. Same
observability. Same Lens chips. Different intent, captured in the
factory name + the resulting `flavor` tag.

## Related

- **[Injection Engine README](../../src/lib/injection-engine/README.md)**
- **[Dynamic ReAct](./05-dynamic-react.md)** — same idea, multi-iteration
  morph
