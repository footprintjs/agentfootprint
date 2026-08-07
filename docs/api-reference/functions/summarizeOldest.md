[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / summarizeOldest

# Function: summarizeOldest()

> **summarizeOldest**(`options`): [`WindowStrategy`](/agentfootprint/api/generated/interfaces/WindowStrategy.md)

Defined in: [src/core/agent/window/strategies/summarizeOldest.ts:57](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/core/agent/window/strategies/summarizeOldest.ts#L57)

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
  .window(summarizeOldest({
    thresholdTokens: 120_000,
    summarizer: anthropic(),
    model: 'claude-haiku-4-5',
  }))
  .build();
// `.compaction({ ... })` is this exact line, spelled shorter.
```
