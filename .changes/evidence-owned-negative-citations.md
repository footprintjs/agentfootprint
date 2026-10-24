---
type: breaking
---
**The library derives negative claim types and searched subjects from cited evidence.** Models can send only result handles. The runtime chooses the scoped statement from admitted search records and checks other reads using the recorded populations, preserving caller binding, contradiction, freshness, write and completeness safeguards. Raw empty lists and missing evidence never become declared absence.

Migration: remove `kind` and `about` from the model contract by updating both the app parser and JSON Schema to require only `restsOn`. Read the delivered runtime `kind` and library statement rather than treating model fields as checked. Existing app schemas/parsers can retain these fields; their values no longer steer the checker. A differing model kind produces the audit-only `model-kind-ignored` note. `about` is unchecked display text and makes answer delivery `recorded`. Incompatible evidence kinds stay undetermined. Accuracy and usefulness remain unmeasured; enforcement recommendations and release status are unchanged.

Complete statements count all admitted facts, series points and edges. Row identities appear only when the full native rowset reached the model unchanged; middleware-hidden values remain hidden. The statement template version advances from 5 to 6.
