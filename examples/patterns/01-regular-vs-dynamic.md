---
name: Regular vs Dynamic ReAct loop
group: patterns
guide: ../../docs/guides/patterns.md#loop-patterns--agentpattern
defaultInput: What is the weather in San Francisco?
---

# Regular vs Dynamic ReAct loop

The `AgentPattern` flag controls **where the loop jumps back to** after tool execution — which determines which stages re-run each iteration.

| Pattern | Loop target | Re-evaluates each turn |
|---|---|---|
| `AgentPattern.Regular` (default) | `CallLLM` | Only the loop body |
| `AgentPattern.Dynamic` | `SystemPrompt` | All three slots + loop body |

## When to use Dynamic

- **Progressive authorization** — unlock admin tools after `verify_identity` succeeds.
- **Adaptive prompts** — tighten the prompt if the LLM starts looping.
- **Context-dependent tooling** — swap the tool set once a document class is known.

For the typical fixed-persona agent, **stay on Regular** — Dynamic re-runs the prompt/messages/tools subflows every turn, multiplying their cost.

## Key API

- `Agent.create({ provider }).pattern(AgentPattern.Dynamic).build()`
- `.skills(registry)` auto-promotes to `Dynamic` if the registry has auto-activate skills.

## Related

- **[docs/guides/patterns.md](../../docs/guides/patterns.md#loop-patterns--agentpattern)** — full explanation with ASCII flow diagrams.
- **[Agent concept](../concepts/02-agent.md)** — the loop this pattern modulates.
