---
title: "~~Function: semantic()~~"
---

# ~~Function: semantic()~~

> **semantic**(`decl`): [`ToolSemantics`](/docs/api/interfaces/ToolSemantics)

Defined in: [src/lib/semantics/envelope.ts:1023](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/envelope.ts#L1023)

Say "here is typed data, with the caveats that make it honest" in a shape
the framework recognizes, the record keeps whole, and a build gate can
refuse — from a declaration that copies the wire's snake_case names
through (`measured_at`, `is_counter`, `filter_note`).

Returns the value a tool's `execute` should return. The framework
recognizes it at the dispatch boundary: the MODEL reads the compact
projection ([semanticsForModel](/docs/api/functions/semanticsForModel)), the FULL envelope rides the typed
`agentfootprint.tools.semantics_declared` event, and a declared `coverage`
flows through the same channel `coverage()` uses.

Refuses (throws, at the call site — the `absent()` law) any declaration
this vocabulary cannot honor: series without grain, data without
provenance, a counter-looking aggregation with `is_counter` unstated, and
every malformed shape — each refusal names the field and the fix. A key
the declaration, or one of its objects (`grain`, `provenance`,
`coverage`, `clarify`, `render`), does not have is refused too, naming the
spelling meant when it is a casing slip (`not_checked` → `notChecked`),
so nothing declared from plain JavaScript or JSON vanishes without a word.
A camelCase `measuredAt` is refused here, naming `measured_at`: this door
takes one spelling.

Every refusal starts `refused: ` and never with this function's name:
inside a tool's `execute` it becomes the call's error result, and the
model reads it. "refused: this result carries series/facts with no
provenance — …" reads as a refusal, where "semantic: carries …" read like
a finding.

## Parameters

### decl

[`SemanticDeclaration`](/docs/api/interfaces/SemanticDeclaration)

## Returns

[`ToolSemantics`](/docs/api/interfaces/ToolSemantics)

## Deprecated

Use [describedResult](/docs/api/functions/describedResult) — the same envelope, byte for
byte, from a declaration spelled the way code is written (`measuredAt`,
`ageSeconds`, `sourceExportDate`, `isCounter`, `filterNote`, `chartHint`),
with a missing `provenance` caught by the compiler. The name `semantic`
read as semantic search. This function keeps working unchanged, and
keeps its own spelling: switching the name alone makes each
`measured_at` a refusal that names `measuredAt`, never a silent loss.

## Example

```ts
a per-port IOPS tool
  return semantic({
    series: rows.map((r) => ({ t: r.time, entity: r.port, metric: 'avg_iops', value: r.iops })),
    grain: { interval: '30m', aggregation: 'avg', is_counter: false },
    provenance: { measured_at: latestSampleTime, source: 'InfluxDB SwitchPortStats' },
    coverage: {
      checked: ['shq-fab-a: all 48 FC ports'],
      notChecked: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
    },
    render: { default: 'table', columns: ['entity', 'value'], sort: 'value desc' },
  });
```
