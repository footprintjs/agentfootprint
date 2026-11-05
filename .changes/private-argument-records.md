---
type: security
---
**Keep hidden human answers out of retained run records across every pause.** Private argument fields now use the run's existing native redaction rule through repeated questions, kept answers and check-ins. Actual tool computation and raw checkpoints retain their values; recorders and served snapshots keep the selected fields masked, while public operation details remain visible. Caller policies retain their existing precedence.

Migration: dynamically discovered tools with private argument views require a native redaction policy or a statically declared private tool capability before discovery; otherwise the run refuses with `ERR_PRIVATE_ARGUMENT_RECORD`. Check-in approvers see the tool's explicitly masked view. Private-only served views omit their raw fold base and report `no-fold-base`; retain raw checkpoints securely for execution, not as public records.

Hypothetical schema-default and time-window prose for a tool with an argument mapper omits values conservatively because it has no actual call context. Real-call notes and rows use the complete filled arguments. Conservative native copy marks retain their privacy effects on resume without becoming caller-policy claims.

A private-only checkpoint explicitly declares that it had no caller policy. Removing a saved caller policy is refused even when internal private selectors remain. A pending private question retains its original field and member names; resuming it after the required tool view disappears is refused before the answer is bound. This checks retained capability, not semantic equality of a replacement view function.
