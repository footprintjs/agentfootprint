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

The native record now retains explicit read-window commit counts where a step
observed state before a sibling committed. Record readers must preserve `beganAt`
and `sawUntil`; these are commit-count boundaries rather than wall clocks. Do not
date such reads at the later commit or discard the new provenance fields.
