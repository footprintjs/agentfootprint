---
title: EvidenceShape
---

# Interface: EvidenceShape

Defined in: [src/core/agent/evidence/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L46)

A domain's own identifier shape.

The default extractor guesses conservatively from punctuation and digits (see
`extract.ts`). It cannot know that `SHPMAXDLVAP001-FA0` is an array alias or
that `ORD-4471` is an order number, and it deliberately does NOT flag things
that look like prose. Declaring a shape says "in MY domain, a token that
looks like this is data" — the declared set composes WITH the default rules
rather than replacing them.

The pattern is matched against a whole token, so `^` / `$` are unnecessary
(harmless if present). `g` / `y` flags are stripped at resolve time — a
stateful regex reused across tokens skips matches.

## Properties

### match

> `readonly` **match**: `RegExp`

Defined in: [src/core/agent/evidence/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L51)

The pattern. Matched against a whole normalized token.

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/evidence/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L49)

Short name. Appears on the flagged value so a reader knows which rule
 caught it. Must be unique within one agent.
