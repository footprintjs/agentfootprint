---
name: Swarm — LLM-routed specialists
group: concepts
guide: ../../docs/guides/concepts.md#swarm
defaultInput: I need a refund for my last bill.
---

# Swarm — LLM-routed specialists

> **Like:** a project manager who reads each request and assigns it to the right specialist on the team.

An orchestrator agent reads the request and delegates to specialist runners by calling them as tools (`agentAsTool` under the hood). Routing happens at **runtime** based on what the orchestrator's LLM decides.

**Background:** the orchestrator-worker pattern, popularized by OpenAI's *Swarm* (2024) reference implementation.

## When to use

- Customer support triage where categories aren't predictable enough for static rules.
- Multi-domain assistants where the orchestrator needs to *understand* the request before routing.
- When you want the LLM to decompose: "this request needs steps A, B, C from three different specialists."

## What you'll see in the trace

The orchestrator fires a tool call to delegate; the specialist runs as a subflow:

```
Entered Swarm[support-swarm].
  Iteration 1:
    Entered CallLLM. → tool_use: delegate_billing(...)
    Entered ExecuteTools.
      Entered billing (specialist subflow).
        → "Your refund of $50 has been processed."
  Iteration 2:
    Entered CallLLM. → "The billing team has processed your refund."
    → routed to 'final'
Entered Finalize.
```

## Key API

- `Swarm.create({ provider, name? })` — orchestrator builder.
- `.specialist(id, description, runner)` — register a specialist. `description` is what the orchestrator's LLM reads to decide routing.
- `.tool(toolDef)` — also add non-agent tools to the orchestrator (e.g. for state lookup).

## Failure modes

- Orchestrator hallucinates a specialist name → call returns `{ error: true }`; orchestrator may recover or loop.
- Specialist throws → flows back as a tool error; orchestrator decides what to do.
- **Cost note:** every specialist invocation is also wrapped as an LLM tool call → orchestrator pays its own LLM cost on top of each specialist's cost. Don't reach for Swarm when **[Conditional](./06-conditional.md)** would do.

## Related concepts

- **[Conditional](./06-conditional.md)** — same intent, no LLM in routing.
- **[FlowChart](./04-flowchart.md)** — when routing isn't dynamic at all.
