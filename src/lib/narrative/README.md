# narrative/

Agent-optimized narrative rendering.

## Why

The CombinedNarrativeRecorder (footprintjs) captures every scope read/write with `rawValue` and `key`. This module provides an agent-specific renderer that formats narrative for LLM debugging.

For grounding analysis (sources vs claims), use `ExplainRecorder` from `agentfootprint/explain` — it collects during traversal via recorder hooks.

## Usage

```typescript
import { createAgentRenderer } from 'agentfootprint/explain';

// Verbose narrative (full values, no truncation)
const agent = Agent.create({ provider }).verbose().build();
```

## API

| Export | Type | Description |
|--------|------|-------------|
| `createAgentRenderer()` | Factory | Agent-optimized NarrativeRenderer with verbose mode |
| `AgentRendererOptions` | Type | `{ verbose?: boolean }` |

## See Also

- `ExplainRecorder` in `agentfootprint/explain` — grounding analysis (sources, claims, decisions)
- [Grounding Guide](../../../docs/guides/grounding.md)
