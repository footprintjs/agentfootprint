---
title: summarizeOldest
---

# Function: summarizeOldest()

> **summarizeOldest**(`options`): [`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

Defined in: [src/core/agent/window/strategies/summarizeOldest.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategies/summarizeOldest.ts#L57)

Fold the oldest contiguous run of foldable turns into one summary message,
keeping the recent turns and stepping over anything unresolved.

Triggered by COUNTED tokens: the last call's adapter-reported input tokens
against `thresholdTokens`. A provider that reports no usage gets
`CompactionUnmeasurableError` rather than an invented number.

## Parameters

### options

[`CompactionOptions`](/docs/api/interfaces/CompactionOptions)

## Returns

[`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

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
