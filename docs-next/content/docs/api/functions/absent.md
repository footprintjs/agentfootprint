---
title: absent
---

# Function: absent()

## Call Signature

> **absent**(`decl`): `DeclaredToolAbsence`

Defined in: [src/semantics/coverage/absent.ts:326](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/absent.ts#L326)

Say "I looked, and there is nothing" in a way a model cannot read as a
failure — and cannot productively retry.

Returns the value a tool's `execute` should return. The framework
recognizes it at the dispatch boundary and gives it a delivered status of
`'absent'` (routable by `onToolStatus`), a `tools.absent` event, and an
evidence-corpus rule of its own.

Refuses (throws, where it is called) a declaration it cannot honor — and
any key the declaration does not have, naming the spelling meant when the
key is a casing slip (`not_checked` → `notChecked`), so a list declared
from plain JavaScript or JSON cannot vanish without a word. Every refusal
starts `refused: `: inside `execute` it becomes the call's error result,
which the model reads.

Since honesty step 7b an absence also says WHERE it looked and WHEN —
`provenance: { measuredAt, source }`, the shape and rules `describedResult()`
uses — and what time its read covered — `period: { queried, held, readAt? }`,
ISO 8601 instants with a zone (`held` may be `'unknown'`). "Searched the 02:00
export — nothing" becomes data; the results layer judges the period.

A name looked up in a known list is a search over that list: declare the
list as `among` (see [AbsenceAmongDeclaration](/docs/api/interfaces/AbsenceAmongDeclaration)) and the mint composes
the names facet, the gap "names outside <source>" — which only
`among.authoritative` removes; a `partial` read also gets "not every name in
<source> was read", which nothing removes — and the `provenance`. The names are read only
to check `count`; none is served.

### Parameters

#### decl

`DeclaredAbsenceDeclaration`

### Returns

`DeclaredToolAbsence`

### Example

```ts
a port-lookup tool that found no matching FLOGI
  defineTool({
    name: 'flogi_for_port',
    description: 'FLOGI entries for one interface',
    inputSchema: { type: 'object', properties: { switch: { type: 'string' },
      port: { type: 'string' } }, required: ['switch', 'port'] },
    execute: ({ switch: sw, port }) => {
      const rows = fcns.flogi(sw, port);
      if (rows.length > 0) return rows;
      return absent({
        what: `FLOGI entries on ${port}`,
        checked: [
          `${sw}: the live fcns database`,
          { what: 'window: the last 24h', why: 'FLOGI history retention on this fabric' },
        ],
        notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
        cannotCover: [{ what: 'ports on the peer fabric',
          why: 'this collector is scoped to one fabric' }],
        tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
      });
    },
  });
```

## Call Signature

> **absent**(`decl`): [`ToolAbsence`](/docs/api/interfaces/ToolAbsence)

Defined in: [src/semantics/coverage/absent.ts:327](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/absent.ts#L327)

Say "I looked, and there is nothing" in a way a model cannot read as a
failure — and cannot productively retry.

Returns the value a tool's `execute` should return. The framework
recognizes it at the dispatch boundary and gives it a delivered status of
`'absent'` (routable by `onToolStatus`), a `tools.absent` event, and an
evidence-corpus rule of its own.

Refuses (throws, where it is called) a declaration it cannot honor — and
any key the declaration does not have, naming the spelling meant when the
key is a casing slip (`not_checked` → `notChecked`), so a list declared
from plain JavaScript or JSON cannot vanish without a word. Every refusal
starts `refused: `: inside `execute` it becomes the call's error result,
which the model reads.

Since honesty step 7b an absence also says WHERE it looked and WHEN —
`provenance: { measuredAt, source }`, the shape and rules `describedResult()`
uses — and what time its read covered — `period: { queried, held, readAt? }`,
ISO 8601 instants with a zone (`held` may be `'unknown'`). "Searched the 02:00
export — nothing" becomes data; the results layer judges the period.

A name looked up in a known list is a search over that list: declare the
list as `among` (see [AbsenceAmongDeclaration](/docs/api/interfaces/AbsenceAmongDeclaration)) and the mint composes
the names facet, the gap "names outside <source>" — which only
`among.authoritative` removes — and the `provenance`. The nearest names
(`visible: 'caller'` only) are kept OFF the envelope, on the library's
channel, and attached to the model's message alone.

### Parameters

#### decl

[`AbsenceDeclaration`](/docs/api/interfaces/AbsenceDeclaration) \| [`AbsenceAmongDeclaration`](/docs/api/interfaces/AbsenceAmongDeclaration)

### Returns

[`ToolAbsence`](/docs/api/interfaces/ToolAbsence)

### Example

```ts
a port-lookup tool that found no matching FLOGI
  defineTool({
    name: 'flogi_for_port',
    description: 'FLOGI entries for one interface',
    inputSchema: { type: 'object', properties: { switch: { type: 'string' },
      port: { type: 'string' } }, required: ['switch', 'port'] },
    execute: ({ switch: sw, port }) => {
      const rows = fcns.flogi(sw, port);
      if (rows.length > 0) return rows;
      return absent({
        what: `FLOGI entries on ${port}`,
        checked: [
          `${sw}: the live fcns database`,
          { what: 'window: the last 24h', why: 'FLOGI history retention on this fabric' },
        ],
        notChecked: [{ what: 'the archived FLOGI history', why: 'older than the 24h window' }],
        cannotCover: [{ what: 'ports on the peer fabric',
          why: 'this collector is scoped to one fabric' }],
        tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
      });
    },
  });
```
