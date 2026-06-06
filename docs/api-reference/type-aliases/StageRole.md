[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StageRole

# Type Alias: StageRole

> **StageRole** = `"hero-slot"` \| `"hero-llm"` \| `"hero-action"` \| `"plumbing"` \| `"boundary"`

Defined in: [src/conventions.ts:193](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/conventions.ts#L193)

Semantic role of a stage, used by renderers to decide visual emphasis.

The agent's chart mixes a handful of stages users actually care about
(the HEROES — what context was built, what the model decided, what it did)
with mechanism stages (PLUMBING). This is the ONE place that says which is
which; renderers stay generic and style purely off this role (e.g. heroes
prominent, plumbing muted). Keeping it here — the semantic owner — avoids
the "name-based filter list duplicated across renderers" anti-pattern.

- `hero-slot`   — a context slot (system-prompt / messages / tools)
- `hero-llm`    — the LLM invocation
- `hero-action` — tool execution (the agent's actions)
- `plumbing`    — mechanism (injection engine, cache, route, thinking, …)
- `boundary`    — neutral chart boundaries (Initialize root, Final) +
                  anything unrecognised (rendered normally, never muted)
