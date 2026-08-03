---
name: Fact — developer-supplied data injection
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: When did I sign up?
---

# Fact — developer-supplied data injection

`defineFact` is the **Context-style** flavor. Where Skills/Steering/
Instructions tell the LLM *what to do* (behavior), Facts tell the LLM
*what's true* (data).

> If the LLM doesn't have the fact, it'll hallucinate. If the LLM has
> too many facts, the prompt bloats. `defineFact` is how you decide,
> per turn, what the LLM gets to see.

## When to use

- **User profile** — name, plan, role, preferences, locale
- **Environment info** — current time, server region, feature flags
- **Computed summary** — "user has 3 open tickets, 2 unread messages"
- **Cached state** — "last viewed page: pricing"
- **Domain facts** — fixed knowledge that's not in the LLM's training
  cutoff (your company's product names, internal terminology)

## What's NOT a Fact

- **Tool returns** — those land in `messages` automatically (baseline)
- **Conversation history** — already in messages
- **Behavior rules** — that's `defineInstruction` or `defineSteering`
- **LLM-discoverable knowledge** — that's `defineSkill` (the LLM picks
  when to read it)

## Key API

```ts
import { Agent } from 'agentfootprint'
import { defineFact } from 'agentfootprint/injection-engine';

// Always-on, system-prompt slot (default)
const userProfile = defineFact({
  id: 'user-profile',
  data: `Name: ${user.name}, Plan: ${user.plan}`,
});

// Conditional via predicate
const sessionContext = defineFact({
  id: 'session',
  data: 'Started via chat widget on pricing page',
  activeWhen: (ctx) => ctx.iteration >= 1,
});

// Volatile data — same slot, but tell the cache not to freeze it
const liveMetric = defineFact({
  id: 'live-status',
  data: 'Server load: 42%. All systems nominal.',
  cache: 'never',
});
```

A fact lands in the system-prompt slot by default — the one every provider
delivers. Since 7.21.0 `slot: 'messages'` delivers too, with a `role` you name:
the fact is appended to the conversation window itself. Both wire rules apply —
a role the attached provider does not carry inside `messages` is refused when
the run starts, and a role that would repeat the turn already at the end of the
window is deferred to the next boundary rather than reordered.

## What it emits

- `agentfootprint.context.evaluated` — engine reports active facts
- `agentfootprint.context.injected` — `source: 'fact'`, `sourceId: 'user-profile'`,
  `slot: 'system-prompt'`

## Related

- **[Instruction](./01-instruction.md)** — behavior, not data
- **[Skill](./02-skill.md)** — LLM-activated knowledge bundles
- **[Steering](./03-steering.md)** — always-on policies
- **[Memory](../memory/01-default.md)** *(coming v2.1)* — persistent facts across turns
- **[RAG](../README.md)** *(coming v2.1)* — retrieval-driven facts
