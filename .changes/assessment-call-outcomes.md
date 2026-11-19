---
type: breaking
bump: major
---

**The answer's standing now reports a tool call that was refused or failed.** A later
completed call of the same tool with equal recorded arguments clears the earlier
reason. Calls whose arguments are unavailable or hidden cannot establish a match.
The answer account also shows a recorded non-success status for a tool that ran.

Migration: Handle the new `call-not-completed` assessment reason in code that
switches exhaustively on reason types. Displays that show the standing may now say
"not sure" for a turn that previously said "not assessed" or "consistent."
