---
title: DescribedResultDeclaration
---

# Type Alias: DescribedResultDeclaration

> **DescribedResultDeclaration** = `object` & \{ `provenance`: \{ `ageSeconds?`: `number`; `measuredAt`: `string`; `source`: `string`; `sourceExportDate?`: `string`; \}; \} \| \{ `facts?`: `undefined`; `series?`: `undefined`; \}

Defined in: [src/lib/semantics/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L256)

What a tool author passes to `describedResult()` — the
result fields in ONE spelling, camelCase, respelled to
the unchanged snake_case wire ([ToolSemantics](/docs/api/interfaces/ToolSemantics)).

`provenance` is REQUIRED whenever `series` or `facts` is present, and the
compiler says so: a number with no source and no age is refused at run time
anyway, inside the tool, where the model reads the refusal. A declaration
with only `edges` or only a `clarify` question needs none.

At least one of `series`, `facts`, `edges` or a non-null `clarify` must be
present — an envelope with no data and no question declares nothing. There
is no `notCovered`: the prose list the model reads is derived from
`coverage`, so the two can never disagree.

## Type Declaration

### clarify?

> `readonly` `optional` **clarify?**: [`SemanticClarify`](/docs/api/interfaces/SemanticClarify) \| `null`

A question the result hands back instead of picking silently. `null`
 states "ambiguity was considered; there is none". It does not pause the
 run — the model reads it and decides what to ask.

### coverage?

> `readonly` `optional` **coverage?**: [`CoverageDeclaration`](/docs/api/interfaces/CoverageDeclaration)

The coverage()-vocabulary declaration this result absorbs.

### edges?

> `readonly` `optional` **edges?**: readonly [`SemanticEdge`](/docs/api/interfaces/SemanticEdge)[]

Typed relationships — `{ from, to, kind }`.

### facts?

> `readonly` `optional` **facts?**: readonly [`SemanticFact`](/docs/api/interfaces/SemanticFact)[]

Typed rows about entities — every row names its `entity`.

### grain?

> `readonly` `optional` **grain?**: `object`

What one value MEANS. Required with `series`.

#### grain.aggregation?

> `readonly` `optional` **aggregation?**: `string`

How the values were folded ('avg', 'max', 'sum', 'count', …).

#### grain.collapsed?

> `readonly` `optional` **collapsed?**: `string`

What was folded away ('per-port rows collapsed to per-switch').

#### grain.interval?

> `readonly` `optional` **interval?**: `string`

The collection interval the values live on ('30m', '1h', 'daily').

#### grain.isCounter?

> `readonly` `optional` **isCounter?**: `boolean`

Whether the values are counters — cumulative readings a reader must never
add together. MUST be stated (true or false) whenever `aggregation` is
counter-looking (see [COUNTER\_AGGREGATION\_WORDS](/docs/api/variables/COUNTER_AGGREGATION_WORDS)).

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

What the READ behind the data covered in time (honesty step 7b) — the
instants it asked for (`queried`), what the store holds (`held`, or
`'unknown'` said out loud) and when the read ran (`readAt`). Every value
is an ISO 8601 instant with a zone; the model reads it as declared, and
the results layer files its verdict.

### provenance?

> `readonly` `optional` **provenance?**: `object`

Where the values came from and how old they are. Required with
 `series` or `facts`.

#### provenance.ageSeconds?

> `readonly` `optional` **ageSeconds?**: `number`

How stale the data was when the tool answered, in seconds.

#### provenance.measuredAt

> `readonly` **measuredAt**: `string`

When the WORLD was measured, in the tool's own clock words — never
parsed. Take it from the data: the export's time for a file, the moment
of the read for a live query, the newest sample for a series, and the END
of the window for a value computed over one.

#### provenance.source

> `readonly` **source**: `string`

The system of record the values were read from.

#### provenance.sourceExportDate?

> `readonly` `optional` **sourceExportDate?**: `string`

For file-fed collectors: the export the values rode in on.

### render?

> `readonly` `optional` **render?**: `object`

Hints for a UI. The model never reads them.

#### render.chartHint?

> `readonly` `optional` **chartHint?**: `string`

Chart-shape hint ('line per entity').

#### render.columns?

> `readonly` `optional` **columns?**: readonly `string`[]

Column order for a tabular view.

#### render.default

> `readonly` **default**: `string`

The default presentation ('table', 'chart', 'prose', …). A hint.

#### render.filterNote?

> `readonly` `optional` **filterNote?**: `string`

A note about what filtering already happened ('replicas excluded').

#### render.sort?

> `readonly` `optional` **sort?**: `string`

Sort hint ('avg_iops desc').

### series?

> `readonly` `optional` **series?**: readonly [`SemanticSeriesPoint`](/docs/api/interfaces/SemanticSeriesPoint)[]

Measured points — `{ t, entity, metric, value }`. Needs `grain`.
