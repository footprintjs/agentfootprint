---
title: ReadingChoice
---

# Type Alias: ReadingChoice

> **ReadingChoice** = \{ `by`: `"only"`; `candidate`: `number`; \} \| \{ `by`: `"policy"`; `candidate`: `number`; `policy`: `Partial`\<[`TimePolicy`](/docs/api/interfaces/TimePolicy)\>; \} \| \{ `by`: `"open"`; `open`: readonly [`OpenQuestion`](/docs/api/type-aliases/OpenQuestion)[]; `policy?`: `Partial`\<[`TimePolicy`](/docs/api/interfaces/TimePolicy)\>; `remaining`: readonly `number`[]; \} \| \{ `by`: `"none"`; `why`: `"unreadable"` \| `"unsupported"` \| `"no-candidate"` \| `"excluded-by-policy"`; \}

Defined in: [src/core/time/resolve.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L187)

How a mention's reading settled — recorded on its `time-reading` row.

## Union Members

### Type Literal

\{ `by`: `"only"`; `candidate`: `number`; \}

Every candidate left names the same window.

***

### Type Literal

\{ `by`: `"policy"`; `candidate`: `number`; `policy`: `Partial`\<[`TimePolicy`](/docs/api/interfaces/TimePolicy)\>; \}

The policy removed a reading and one window is left — assumed, recorded.

***

### Type Literal

\{ `by`: `"open"`; `open`: readonly [`OpenQuestion`](/docs/api/type-aliases/OpenQuestion)[]; `policy?`: `Partial`\<[`TimePolicy`](/docs/api/interfaces/TimePolicy)\>; `remaining`: readonly `number`[]; \}

An ask must settle it (a later step raises it): the candidates left and the questions.

***

### Type Literal

\{ `by`: `"none"`; `why`: `"unreadable"` \| `"unsupported"` \| `"no-candidate"` \| `"excluded-by-policy"`; \}
