---
name: Agent with a tool (ReAct)
group: concepts
guide: ../../docs/guides/concepts.md#agent
defaultInput: What is 17 + 25?
---

# Agent with a tool (ReAct)

`LLMCall` + a tool-use loop. The agent calls tools repeatedly, reads the results, then produces a final answer. This is the *ReAct* pattern (Yao et al. 2023, ICLR — *reasoning and acting* interleaved).

## When to use

- Research assistants, code agents, anything that needs to "look something up" before answering.
- When the LLM can't have all the context up front — it needs to fetch some during the conversation.
- The default shape for most production agent use cases.

## What you'll see in the trace

Two iterations of the loop — the LLM calls the tool, then produces a final answer:

```
Entered SeedScope.
Iteration 1:
  Entered CallLLM. → tool_use: add({a: 17, b: 25})
  Entered ParseResponse.
  Entered RouteResponse. → routed to 'tool-calls'
  Entered ExecuteTools.
    add({a: 17, b: 25}) → "42"
  loopTo CallLLM.
Iteration 2:
  Entered CallLLM. → "The sum of 17 and 25 is 42."
  Entered ParseResponse.
  Entered RouteResponse. → routed to 'final'
  Entered Finalize.
```

`result.iterations` reports `2`. The result is **grounded** — the "42" comes from the tool, not from the LLM's training data.

## Key API

- `Agent.create({ provider })` — agent builder.
- `.tool(toolDef)` — register a tool. Define tools with `defineTool({ id, description, inputSchema, handler })`.
- `.maxIterations(n)` — cap the loop (default 10).
- `runner.run(input)` — returns `{ content, messages, iterations }`.

## Failure modes

- Tool throws → result becomes `{ error: true, content: errorMessage }` and flows into the conversation; LLM may retry or apologize.
- Loop hits `maxIterations` → terminates with whatever the LLM last said.

## Related concepts

- **[LLMCall](./01-llm-call.md)** — the rung below; no tool loop.
- **[Patterns: Regular vs Dynamic](../patterns/01-regular-vs-dynamic.md)** — change which slots re-evaluate per iteration.
- **[runtime-features/parallel-tools](../runtime-features/parallel-tools/01-parallel-tools.md)** — execute independent tool calls concurrently within one turn.
