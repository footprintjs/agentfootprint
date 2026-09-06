**Mixed** — the two recorder TIERS. The folder names a tier, not a role.
Trace: `core/` — always-on writers that group raw footprintjs signals into typed
domain events as the walk happens, and that no consumer can disable.
Mixed: `observability/` — the opt-in tier, which holds the ordered event stream
(a Trace), the derived projections consumers read (Folds) and the human-facing
prose (a Lens). Its own README lists which file is which.

## What it reads / what it writes
- Reads footprintjs's channels and `scope.$emit`.
- Writes typed events, and — in the opt-in tier only — detached projections
  rebuilt per call.

## The one law here
Collect during traversal, never post-process. A projection is rebuilt from the
record, never stored beside it.

## Files
- `core/` — the always-on writers.
- `observability/` — the opt-in surfaces.
