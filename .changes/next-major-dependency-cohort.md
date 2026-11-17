---
type: breaking
---
**Require the next major engine and record-library dependency cohort.** The
supported dependency declarations move together; older engine and record-library
lines are no longer included in the declared ranges.

Migration: update `footprintjs` and `foottrace` together to their supported major
lines, then regenerate the application lockfile with strict peer resolution and
run its consumer checks. Older engine and record-library majors are no longer
supported; there is no compatibility shim. Both the application and engine must
resolve one physical Foottrace package image; matching version strings alone are
insufficient.
