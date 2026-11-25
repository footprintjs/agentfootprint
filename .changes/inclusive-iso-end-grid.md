---
type: fixed
---
**A confirmed time window no longer reaches a tool with a nanosecond end.** Since 18.0.0 a tool whose period form has an inclusive ISO end (the `iso-range` shorthand's default) was handed values like `…T15:59:59.999999999Z` after a confirmation, which many date parsers refuse. The inclusive end is again the last instant inside on the grid the cutoff sits on: one second before a whole-second cutoff (`…T15:59:59Z`), one millisecond before a millisecond one, exactly as before 18.0.0 and as an unconfirmed window was already written. An inclusive ISO end is read back on the grid it was written at, and a call that sends exactly the value the library would write for the person's window is still recorded as bound to it.
