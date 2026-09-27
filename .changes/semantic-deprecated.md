---
type: deprecated
---
**`semantic()` is deprecated in favour of `describedResult()`.** The name read as semantic search — a word this library already uses for vector retrieval — and its declaration mixed the wire's snake_case names (`measured_at`, `is_counter`, `filter_note`) with camelCase ones (`notChecked`). `describedResult()` mints the same envelope, byte for byte, from a camelCase declaration, and makes a missing `provenance` beside `series` or `facts` a compile error. `semantic()` keeps working exactly as before — same declaration, same bytes, same refusals — and is marked `@deprecated` in its TSDoc only: no warning is printed. Which major removes it is not decided.

To migrate, rename the call and respell six keys: `measured_at` → `measuredAt`, `age_seconds` → `ageSeconds`, `source_export_date` → `sourceExportDate`, `is_counter` → `isCounter`, `filter_note` → `filterNote`, `chart_hint` → `chartHint`. Each door takes one spelling and refuses the other, naming the one it takes, so a call where only the name changed is refused at that line — nothing is minted without the field.
