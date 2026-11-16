---
type: breaking
---
**Require the next major engine and record-library dependency cohort.** The
supported dependency declarations move together; older engine and record-library
lines are no longer included in the declared ranges.

Migration: update `footprintjs` and `foottrace` together to versions satisfying
the package's new dependency ranges, then regenerate the application lockfile and
run its consumer checks. Both the application and engine must resolve one physical
Foottrace package image; matching version strings alone are insufficient.
