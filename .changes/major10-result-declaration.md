---
type: breaking
---
**One authoring API for described tool results.** Removed the deprecated
`semantic()` helper and `SemanticDeclaration` type. `describedResult()` remains
the canonical authoring API. Saved `ToolSemantics` envelopes, snake_case wire
fields, recognition and model projections are unchanged.

Migration: import `describedResult` and `DescribedResultDeclaration` instead.
Rename declaration keys `is_counter`, `measured_at`, `age_seconds`,
`source_export_date`, `filter_note` and `chart_hint` to `isCounter`, `measuredAt`,
`ageSeconds`, `sourceExportDate`, `filterNote` and `chartHint`. Coverage declaration
keys `notChecked` and `cannotCover` stay as they are. Provide provenance for
series or facts; the canonical declaration type checks this before runtime.
Do not rename fields in saved wire envelopes: `readSemantics()` still reads them.
