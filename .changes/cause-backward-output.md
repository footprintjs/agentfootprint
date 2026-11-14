---
type: added
---
**Optional backward dependency output for recorded root questions.** A host can set `TraceCauseOptions.includeBackward: true` to include the existing bounded backward nodes, edges and proof references in `root_cause`. Omitted or `false` keeps the current output; `impact` and `attention_list` do not request it. The same single Foottrace query, work limits, deadline, cancellation and character ceiling apply. Oversize output is withheld with a truncated gap, and missing evidence stays uncertain. This display option does not establish semantic derivation or a physical cause.
