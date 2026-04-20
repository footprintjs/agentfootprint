---
name: Agent.route() — custom routing branches
group: runtime-features
guide: ../../../docs/guides/patterns.md
defaultInput: I've been waiting 2 weeks with no response, this is unacceptable!
---

# Agent.route() — custom routing branches

The agent's default decider routes between `tool-calls` (call tools) and `final` (respond). `.route({ branches })` lets you **inject your own branches ahead of the defaults** — first match wins, the branch's runner takes over without another LLM call.

The middle ground between a plain Agent (too rigid) and a Swarm (adds another LLM in the loop). Use it when the trigger is a deterministic check on what the agent already said, not another LLM decision.

## When to use

- **Escalation** — agent emits `[ESCALATE]` → route to a human-review runner.
- **Safety guardrail** — agent's output matches a PII regex → route to a redaction runner.
- **Catch-all** — fall through to default routing (tool-calls / final) if no branch matches.

## What you'll see

```
{
  content: '[ROUTED TO HUMAN REVIEW] Ticket queued: "I'\''ve been waiting 2 weeks..."',
}
```

The agent's mock LLM emits `[ESCALATE]`; the `escalate` branch matches; `humanReviewAgent.run(input)` runs and returns the routed response.

## Key API

- `.route({ branches: [{ id, when, runner }] })` on the Agent builder.
- `when: (scope) => boolean` — scope contains `parsedResponse` (LLM output) and the rest of the agent's state.
- `runner: RunnerLike` — any object with `.run(input)`. Plain agents, lazy-loaded specialists, even simple `{ async run() {} }` objects all qualify.

## Difference from Swarm

- **Swarm** uses an LLM orchestrator that decides routing per turn via tool-calling.
- **`.route()`** uses synchronous predicates over the agent's own output. No extra LLM cost.

## Related

- [concepts/06-conditional](../../concepts/06-conditional.md) — top-level routing between runners (no agent loop involved).
- [concepts/07-swarm](../../concepts/07-swarm.md) — LLM-driven routing alternative.
