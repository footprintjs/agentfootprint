[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInScorer

# Type Alias: CheckInScorer

> **CheckInScorer** = (`input`) => readonly [`CheckInDriver`](/agentfootprint/api/generated/interfaces/CheckInDriver.md)[] \| `Promise`\<readonly [`CheckInDriver`](/agentfootprint/api/generated/interfaces/CheckInDriver.md)[]\>

Defined in: [src/core/checkin.ts:235](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/checkin.ts#L235)

Ranks context units by how strongly each drove one tool choice. The
DEFAULT is [lexicalDriverScorer](/agentfootprint/api/generated/variables/lexicalDriverScorer.md) — deterministic, zero LLM, zero
network. Swap in a richer one via `.checkIn({ scorer })`, e.g. wrapping
`explainChoice` from `agentfootprint` with your own embedder.

## Parameters

### input

[`CheckInScoreInput`](/agentfootprint/api/generated/interfaces/CheckInScoreInput.md)

## Returns

readonly [`CheckInDriver`](/agentfootprint/api/generated/interfaces/CheckInDriver.md)[] \| `Promise`\<readonly [`CheckInDriver`](/agentfootprint/api/generated/interfaces/CheckInDriver.md)[]\>

## Example

```ts
a semantic scorer
  const scorer: CheckInScorer = async ({ tool, units, signal }) => {
    const ex = await explainChoice({ tool, units, embedder, signal });
    return ex.units.map((u) => ({ id: u.id, channel: u.channel, text: u.text, score: u.score }));
  };
```
