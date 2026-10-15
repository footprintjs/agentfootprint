---
type: internal
---
**The time layer moved to `src/time/`.** `src/core/time/` (instants, ranges, zones, the run clock, the readers) became the top-level `src/time/`, with its tests in `test/time/`. The layer imports nothing outside itself, so artifacts and integrity no longer reach into `core/` for it: four upward imports left the layer table's allowance list, and `src/time/` is checked to stay closed by `npm run check:layering`. Internal paths only: the `/time` door and every other door export the same names.
