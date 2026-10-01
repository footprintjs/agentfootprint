---
title: englishTimeReader
---

# Function: englishTimeReader()

> **englishTimeReader**(`options?`): [`TimeReader`](/docs/api/interfaces/TimeReader)

Defined in: [src/core/time/readers/english.ts:763](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/readers/english.ts#L763)

The library's careful English reader: a `kind: 'rule'` tokenizer over the
v1 phrases of the time design's § 5.3, "unreadable" for every other time
phrase it recognises. No dependency; deterministic over the text.

## Parameters

### options?

[`EnglishTimeReaderOptions`](/docs/api/interfaces/EnglishTimeReaderOptions) = `{}`

## Returns

[`TimeReader`](/docs/api/interfaces/TimeReader)

## Example

```ts
Agent.create({ provider, model })
  .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
  .build();
```
