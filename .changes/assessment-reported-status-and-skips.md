---
type: breaking
bump: major
---

**The answer's standing reports unfinished tool work and skipped steps.** It
reads an admitted partial or pending result and the committed record of a
procedure advancing past a declared step.

Migration: Handle `work-not-finished` and `step-skipped` in exhaustive
assessment reason switches. Tool history can now include the record-only
`reportedStatus` field. An inline result that fails validation after the
envelope is read now omits the rejected status from its end event, matching
the resumed paths.
