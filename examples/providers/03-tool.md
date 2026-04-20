---
name: ToolProvider — registry pattern
group: providers
guide: ../../docs/guides/providers.md#toolprovider
defaultInput: ''
---

# ToolProvider — registry pattern

`ToolRegistry` decouples tool definitions from the agents that use them. Define a tool once with `defineTool(...)`, register it, then any agent (or any `ToolProvider`) can pull it by id.

## When to use

- You have a shared catalog of tools (calculators, search, lookups) used by multiple agents.
- You need runtime introspection — "list all tools available", "does tool X exist".
- You want to plug different tool sources together (registry + MCP + dynamic) via `compositeTools`.

## What you'll see

This example doesn't run an LLM — it shows registry semantics:

```
{
  tools: ['calculator', 'weather'],
  count: 2,
  hasCalculator: true,
}
```

## Key API

- `new ToolRegistry()` — empty registry.
- `.register(toolDef)` — add a tool.
- `.get(id)` — retrieve by id (returns `undefined` if missing).
- `.all()` — list every registered tool.

## Related

- [providers guide](../../docs/guides/providers.md#toolprovider) — `ToolProvider` strategies that wrap registries.
- [security/01-gated-tools](../security/01-gated-tools.md) — filter tools by permission before they reach the LLM.
- [concepts/02-agent](../concepts/02-agent.md) — agent that consumes tools.
