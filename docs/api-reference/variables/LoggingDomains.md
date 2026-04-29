[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingDomains

# Variable: LoggingDomains

> `const` **LoggingDomains**: `object`

Defined in: [agentfootprint/src/recorders/observability/LoggingRecorder.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/LoggingRecorder.ts#L36)

Domain constants — one per event-registry domain. Use these instead of
raw strings for autocomplete, typo protection, and rename safety.

Raw strings still work (backed by the same literal union type below).

## Type Declaration

### AGENT

> `readonly` **AGENT**: `"agent"` = `'agent'`

Agent lifecycle (turn · iteration · route_decided · handoff).

### COMPOSITION

> `readonly` **COMPOSITION**: `"composition"` = `'composition'`

Composition control flow (Sequence / Parallel / Conditional / Loop).

### CONTEXT

> `readonly` **CONTEXT**: `"context"` = `'context'`

Context-engineering events (the 3-slot model). THE DEBUG CORE.

### COST

> `readonly` **COST**: `"cost"` = `'cost'`

Cost + budget tracking.

### EMBEDDING

> `readonly` **EMBEDDING**: `"embedding"` = `'embedding'`

Embedding generation.

### ERROR

> `readonly` **ERROR**: `"error"` = `'error'`

Error retries + recoveries.

### EVAL

> `readonly` **EVAL**: `"eval"` = `'eval'`

Eval scores + threshold crossings.

### FALLBACK

> `readonly` **FALLBACK**: `"fallback"` = `'fallback'`

Provider / tool / skill fallback triggers.

### MEMORY

> `readonly` **MEMORY**: `"memory"` = `'memory'`

Memory strategy + store operations.

### PAUSE

> `readonly` **PAUSE**: `"pause"` = `'pause'`

Pause / resume requests.

### PERMISSION

> `readonly` **PERMISSION**: `"permission"` = `'permission'`

Permission checks + gates.

### RISK

> `readonly` **RISK**: `"risk"` = `'risk'`

Risk / guardrail detections.

### SKILL

> `readonly` **SKILL**: `"skill"` = `'skill'`

Skill activation + deactivation.

### STREAM

> `readonly` **STREAM**: `"stream"` = `'stream'`

LLM + tool request/response stream.

### TOOLS

> `readonly` **TOOLS**: `"tools"` = `'tools'`

Tool offered / activated / deactivated.

## Example

```ts
agent.enable.logging({ domains: [LoggingDomains.CONTEXT, LoggingDomains.STREAM] });
  agent.enable.logging({ domains: ['context', 'stream'] }); // equivalent
```
