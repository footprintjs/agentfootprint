---
title: PERIOD_WIRE
---

# Variable: PERIOD\_WIRE

> `const` **PERIOD\_WIRE**: `Readonly`\<\{ `from`: `"from"`; `held`: `"held"`; `heldUnknown`: `"unknown"`; `key`: `"period"`; `queried`: `"queried"`; `readAt`: `"read_at"`; `to`: `"to"`; \}\>

Defined in: [src/core/agent/coverage/period.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L112)

The period's wire spelling as DATA — every reserved key and the one literal
(`'unknown'`) — so a tool written in another language mints it byte for
byte. `canonical-notes.json` publishes it, generated from this constant
(`scripts/gen-canonical-notes.mjs`): the JSON cannot disagree with the code.

## Example

```ts
PERIOD_WIRE.readAt; // 'read_at' — the one key whose wire spelling differs
```
