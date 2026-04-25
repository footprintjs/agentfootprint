---
name: Swarm — multi-agent handoff (OpenAI Swarm)
group: v2-patterns
guide: ../../README.md#patterns
defaultInput: my invoice is wrong
---

# Swarm — multi-agent handoff

A router picks which specialist agent handles the next turn. Each
agent's output becomes the next iteration's input. The router returns
an agent id (or `undefined` / an unknown id to halt). Loop budgets
bound runaway handoffs.

**Origin:** OpenAI Swarm experiment (2024).

## Built from

```
Loop(Conditional(route-to-agent)).until(route-returns-halt)
```

A built-in identity `Done` runner handles the halt branch so the last
message passes through unchanged.

## Key API

```ts
swarm({
  agents: [
    { id: 'triage', runner: triageAgent },
    { id: 'billing', runner: billingAgent },
    { id: 'tech', runner: techAgent },
  ],
  route: (input) => {
    if (input.message.includes('[billing]')) return undefined; // halt
    if (/bill|refund/i.test(input.message)) return 'billing';
    if (/error|status/i.test(input.message)) return 'tech';
    return 'triage';
  },
  maxHandoffs: 10,
});
```

## Tradeoffs

- **Fixed roster** — agents declared at build time. For runtime-discovered
  agents, build a new Swarm per request.
- **Sync router** — the route function is pure over `{ message }`. For
  LLM-driven routing (classic Swarm), use a separate routing LLMCall
  whose output the `route()` function parses.
- **Reserved id `done`** — throws at build time to prevent collision
  with the halt branch.

## Related

- **[Conditional](../core-flow/03-conditional.md)** — the routing primitive Swarm composes
- **[Loop](../core-flow/04-loop.md)** — the iteration primitive Swarm composes
