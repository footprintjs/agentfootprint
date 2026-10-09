---
type: internal
---
**Lint refuses `import * as … from 'footprintjs…'` in `src/`:** footprintjs names are imported by name, so one that leaves its door in the trace extraction fails `tsc`; `src/` has none today.
