[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / summarizeOldest

# Function: summarizeOldest()

> **summarizeOldest**(`options`): [`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

Defined in: [src/core/agent/window/strategies/summarizeOldest.ts:50](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategies/summarizeOldest.ts#L50)

Fold the oldest contiguous run of foldable turns into one summary message,
keeping the recent turns and stepping over anything unresolved.

Triggered by COUNTED tokens: the last call's adapter-reported input tokens
against `thresholdTokens`. A provider that reports no usage gets
`CompactionUnmeasurableError` rather than an invented number.

## Parameters

### options

[`CompactionOptions`](/agentfootprint/api/generated/interfaces/CompactionOptions.md)

## Returns

[`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

## Example

```ts
import { Agent, summarizeOldest } from 'agentfootprint';

const agent = Agent.create({ provider: anthropic(), model: 'claude-sonnet-4-5' })
  .window(summarizeOldest({ thresholdTokens: 120_000, summarizer: anthropic() }))
  .build();
// `.compaction({ ... })` is this exact line, spelled shorter.
```
