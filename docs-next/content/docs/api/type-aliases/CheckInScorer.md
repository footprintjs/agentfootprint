---
title: CheckInScorer
---

# Type Alias: CheckInScorer

> **CheckInScorer** = (`input`) => readonly [`CheckInDriver`](/docs/api/interfaces/CheckInDriver)[] \| `Promise`\<readonly [`CheckInDriver`](/docs/api/interfaces/CheckInDriver)[]\>

Defined in: [src/core/checkin.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L235)

Ranks context units by how strongly each drove one tool choice. The
DEFAULT is [lexicalDriverScorer](/docs/api/variables/lexicalDriverScorer) — deterministic, zero LLM, zero
network. Swap in a richer one via `.checkIn({ scorer })`, e.g. wrapping
`explainChoice` from `agentfootprint` with your own embedder.

## Parameters

### input

[`CheckInScoreInput`](/docs/api/interfaces/CheckInScoreInput)

## Returns

readonly [`CheckInDriver`](/docs/api/interfaces/CheckInDriver)[] \| `Promise`\<readonly [`CheckInDriver`](/docs/api/interfaces/CheckInDriver)[]\>

## Example

```ts
a semantic scorer
  const scorer: CheckInScorer = async ({ tool, units, signal }) => {
    const ex = await explainChoice({ tool, units, embedder, signal });
    return ex.units.map((u) => ({ id: u.id, channel: u.channel, text: u.text, score: u.score }));
  };
```
