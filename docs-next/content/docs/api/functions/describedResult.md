---
title: describedResult
---

# Function: describedResult()

> **describedResult**(`decl`): [`ToolSemantics`](/docs/api/interfaces/ToolSemantics)

Defined in: [src/lib/semantics/described.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/described.ts#L274)

Return rows, a series or relationships from a system of record — WITH the
caveats that make them honest — in a shape the framework recognizes, the
record keeps whole, and a build gate can refuse.

**Where it lives.** It is the tool's RESPONSE: `execute` returns it, and
nothing is added to the system prompt or the tool's schema. The model reads
a compact projection ([semanticsForModel](/docs/api/functions/semanticsForModel): the data, `grain`,
`provenance`, the `not_covered` lines composed from `coverage`, a non-null
`clarify` and a static note) — never the `checked` list, the `render` hints
or the marker. The run record keeps the FULL envelope
(`agentfootprint.tools.semantics_declared`), even when the result is over
the tool's `resultCeiling` and refused. A declared `coverage` also flows
through the channel `coverage()` uses, which is the only part that can reach
the final answer (`.limitsTravelWithTheAnswer()`).

**Values from the data.** `provenance.measuredAt` is when the WORLD was
measured, taken from the data — the export's time, the moment of a live
read, the newest sample of a series, the end of a window — never typed in.
It is never parsed: the library passes your words through.

**The period** (honesty step 7b). `period: { queried, held, readAt? }` says
what time the READ covered — the instants it asked for, and what the store
holds (or `'unknown'`) — as ISO 8601 instants with a zone. The model reads it
as declared; the results layer compares the instants and files its verdict
(covered · partly held · not held · unknown). A malformed period is refused
here.

Refuses (throws, at the call site — the `absent()` law) any declaration
this vocabulary cannot honor: series without `grain`, series or facts
without `provenance.measuredAt` and `provenance.source`, a counter-looking
aggregation with `isCounter` unstated, and every malformed shape. Each
refusal starts `refused: `, names the field as you spelled it, and — inside
`execute` — is the call's error result, which the model reads in place of
the data; the run continues. A snake_case key (`measured_at`,
`not_checked`) is refused, naming the camelCase one.

Use `absent()` when nothing matched and `coverage()` for
any other value that has limits; never wrap one helper's result in another.

## Parameters

### decl

[`DescribedResultDeclaration`](/docs/api/type-aliases/DescribedResultDeclaration)

## Returns

[`ToolSemantics`](/docs/api/interfaces/ToolSemantics)

## Examples

**rows from a nightly export — the time comes from the export**

```ts
const exportTime = snapshot.exportedAt; // when the WORLD was measured
return describedResult({
  facts: rows.map((r) => ({ entity: r.vm, datastore: r.datastore, size_tb: r.sizeTb })),
  provenance: { measuredAt: exportTime, source: 'RVTools export' },
  coverage: {
    checked: [`every VM in the RVTools export of ${exportTime}`],
    cannotCover: [{ what: 'hosts that are not VMware', why: 'RVTools sees VMware only' }],
  },
});
```

**a series — \`measuredAt\` is the newest sample**

```ts
const newest = rows.reduce((a, b) => (a.time > b.time ? a : b)).time;
return describedResult({
  series: rows.map((r) => ({ t: r.time, entity: r.port, metric: 'avg_iops', value: r.iops })),
  grain: { interval: '30m', aggregation: 'avg', isCounter: false },
  provenance: { measuredAt: newest, source: 'InfluxDB SwitchPortStats' },
});
```
