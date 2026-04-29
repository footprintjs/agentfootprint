---
name: Steering — always-on system-prompt rule
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: What is the weather in Tokyo?
---

# Steering — always-on system-prompt rule

`defineSteering` is the simplest Instruction-style flavor — no
predicate, no LLM activation. The text is in the system prompt every
iteration. Use for invariants.

## When to use

- **Output format** — *"Always respond with valid JSON."*
- **Persona** — *"You are Atlas, a concise weather analyst."*
- **Safety policies** — *"Never speculate about events you can't verify."*
- **Style guides** — *"Use metric units only. No emoji."*

## How it differs from `system()`

`Agent.create(...).system('...')` sets the **base** prompt — one block,
tagged `source: 'base'` (baseline LLM-API flow, NOT context engineering).

`defineSteering(...)` registers an Injection — separate chip in Lens,
tagged `source: 'steering'`. Multiple steering docs from different
sources (tenant config + global policy + brand voice) layer cleanly.

You can use both. The base prompt loads first; steering injections
append in registration order.

## Key API

```ts
import { Agent, defineSteering } from 'agentfootprint';

const jsonOnly = defineSteering({
  id: 'json-only',
  prompt: 'Always respond with valid JSON. No prose.',
});

const agent = Agent.create({ provider, model: 'mock' })
  .system('You are a helpful assistant.')   // → source: 'base'
  .steering(jsonOnly)                        // → source: 'steering'
  .build();
```

## What it emits

- `agentfootprint.context.evaluated` — Lens shows steering as active
  every iteration
- `agentfootprint.context.injected` (system-prompt) — `source: 'steering'`,
  `sourceId: 'json-only'`

## Related

- **[Instruction](./01-instruction.md)** — same slot, but predicate-gated
- **[Skill](./02-skill.md)** — LLM-activated body + optional tools
- **[Fact](./04-fact.md)** — data injection (different intent)
