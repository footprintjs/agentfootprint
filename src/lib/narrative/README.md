# narrative/

Agent-optimized narrative rendering and grounding analysis helpers.

## Why

The CombinedNarrativeRecorder (footprintjs) captures every scope read/write with `rawValue` and `key`. This module provides: (1) an agent-specific renderer that formats narrative for LLM debugging, and (2) helpers that extract sources/claims from entries for grounding analysis.

## Usage

```typescript
import { createAgentRenderer, getGroundingSources, getLLMClaims } from 'agentfootprint';

// Verbose narrative (full values, no truncation)
const agent = Agent.create({ provider }).verbose().build();

// After execution — extract grounding data
const entries = agent.getNarrativeEntries();
const sources = getGroundingSources(entries);  // tool results (sources of truth)
const claims = getLLMClaims(entries);           // LLM output (to verify)
```

## API

| Export | Type | Description |
|--------|------|-------------|
| `createAgentRenderer()` | Factory | Agent-optimized NarrativeRenderer with verbose mode |
| `AgentRendererOptions` | Type | `{ verbose?: boolean }` |
| `getGroundingSources()` | Function | Extract tool results from narrative entries |
| `getLLMClaims()` | Function | Extract LLM outputs from narrative entries |
| `getFullLLMContext()` | Function | Full snapshot: systemPrompt, tools, sources, claims, decision |
| `GroundingSource` | Type | Tool result with content, parsed, stageName, stageId |
| `LLMClaim` | Type | LLM output with content, type (final/intermediate) |
| `LLMContextSnapshot` | Type | Complete context for grounding analysis |

## Key Design

- Uses `CombinedNarrativeEntry.key` (footprintjs v4.4.0) + `AgentScopeKey` enum
- Renderer-independent — works with any `NarrativeRenderer`
- Topology-independent — doesn't depend on stage names

## See Also

- [Instructions Guide](../../../docs/guides/instructions.md) — Decision Scope drives what's visible
- [Streaming Guide](../../../docs/guides/streaming.md) — Real-time events vs post-hoc analysis
