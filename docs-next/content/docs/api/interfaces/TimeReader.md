---
title: TimeReader
---

# Interface: TimeReader

Defined in: [src/core/time/reader.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L62)

A strategy that reads a person's words into zone-less PARTS (time design
§ 5.1). Armed with `.time({ reader })`; there is no default. It runs once
per turn, at the seed, on the message a person wrote, and never again for
that message — a resume and a retry read the recorded reading.

## Example

```ts
const reader: TimeReader = {
  id: 'my-app/english', version: '1.2.0', locale: 'en-US', kind: 'rule',
  read: (text) => ({ mentions: tokenize(text) }),
};
Agent.create({ provider, model }).time({ zone: 'UTC', reader }).build();
```

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/core/time/reader.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L64)

Recorded on every reading with the version, e.g. `'agentfootprint/english'`.

***

### kind

> `readonly` **kind**: `"model"` \| `"rule"`

Defined in: [src/core/time/reader.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L69)

`'rule'`: deterministic over the text. `'model'`: an LLM or other learned reader — its readings are never the person's words.

***

### locale

> `readonly` **locale**: `string`

Defined in: [src/core/time/reader.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L67)

The language it reads, e.g. `'en-US'`.

***

### version

> `readonly` **version**: `string`

Defined in: [src/core/time/reader.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L65)

## Methods

### read()

> **read**(`text`, `context`): [`TimeReading`](/docs/api/interfaces/TimeReading) \| `Promise`\<[`TimeReading`](/docs/api/interfaces/TimeReading)\>

Defined in: [src/core/time/reader.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/reader.ts#L70)

#### Parameters

##### text

`string`

##### context

[`TimeReadContext`](/docs/api/interfaces/TimeReadContext)

#### Returns

[`TimeReading`](/docs/api/interfaces/TimeReading) \| `Promise`\<[`TimeReading`](/docs/api/interfaces/TimeReading)\>
