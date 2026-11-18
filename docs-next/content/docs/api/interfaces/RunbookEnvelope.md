---
title: RunbookEnvelope
---

# Interface: RunbookEnvelope

Defined in: [src/core/runbook/types.ts:320](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L320)

The mandatory-spine + optional-projection envelope every runbook returns
 (unless an inner absence passed through — then the answer IS that absence,
 verbatim). Recognized by the framework's coverage funnel at the dispatch
 boundary like any `coverage()` ledger.

## Properties

### af\_coverage

> `readonly` **af\_coverage**: `object`

Defined in: [src/core/runbook/types.ts:321](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L321)

#### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

#### checked?

> `readonly` `optional` **checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

#### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

#### note

> `readonly` **note**: `string`

The static coverage law sentence (the `coverage()` note).

#### sentence

> `readonly` **sentence**: `string`

The run's own sentence — names the rule set and version.

***

### result

> `readonly` **result**: `object`

Defined in: [src/core/runbook/types.ts:330](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L330)

#### Index Signature

\[`appField`: `string`\]: `unknown`

Everything the chart put in its `report` state key — the app's own
 result fields, spread here verbatim BESIDE the spine. Spine keys win:
 a report field spelling `af_coverage`, `af_provenance`, `rule_version`,
 `walk`, `report_note`, or a projection key this run assembled is
 discarded and named in `report_note`.

#### af\_provenance

> `readonly` **af\_provenance**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Re-emitted FIRST: the carried inner provenance stamp (if any inner
 tool declared one — a LOCAL SEED confession survives composition)
 plus this call's own `{tool, toolCallId}`.

#### render\_note?

> `readonly` `optional` **render\_note?**: `string`

The render law, stated to the model — present with the projection in
 BOTH modes, because a rowset always ships with a rule about its
 surface. `VERDICT_RENDER_NOTE` under `'prose'` (output the table
 verbatim); `PANEL_RENDER_NOTE` under `'panel'` (the rows are already on
 screen — quote the evidence, never reproduce them). An unavailable rowset
 instead carries a fixed note that no total or empty result was established.

#### report\_note?

> `readonly` `optional` **report\_note?**: `string`

Present ONLY when the chart's `report` spelled one of the envelope's
 own names: it names every discarded field and says the values under
 those names are the bridge's. Absent on the clean path.

#### rows\_complete?

> `readonly` `optional` **rows\_complete?**: `boolean`

False when the rowset was unavailable or the visible rows were capped.

#### rows\_shown?

> `readonly` `optional` **rows\_shown?**: `number`

#### rows\_total?

> `readonly` `optional` **rows\_total?**: `number`

Known only when the served state supplied a complete readable rowset.
 Omitted when unavailable; zero means an actual empty rowset.

#### rule\_version

> `readonly` **rule\_version**: `string`

`rules.version`, or the honest `'undeclared'` when no rules were
 declared — the field never silently vanishes.

#### table?

> `readonly` `optional` **table?**: `string`

Pre-rendered markdown table over the SAME readable rows as `verdicts`. Present
 under `presentation: 'prose'` (the default), where the model's prose is
 the rowset's only surface. ABSENT — the key itself, not an empty
 string — under `'panel'`, where the host draws the rowset and a second
 copy in prose would be a retype of what the reader can already see. The
 name stays RESERVED in both modes, so a chart's `report` cannot put a
 table back into a panel answer. Unavailable rowsets also omit it.

#### verdict\_meanings?

> `readonly` `optional` **verdict\_meanings?**: `Readonly`\<`Record`\<`string`, `string`\>\>

branch → meaning, GENERATED from the decider's declared branches and
 the rule labels this run's evidence carried — never hand-restated.

#### verdicts?

> `readonly` `optional` **verdicts?**: readonly [`VerdictRow`](/docs/api/interfaces/VerdictRow)[]

#### walk

> `readonly` **walk**: [`WalkDescriptor`](/docs/api/interfaces/WalkDescriptor)

The recorded walk — always present.
