---
type: added
---
**The trace tools can open a subflow's own log: `inspect_subflow`.** A subflow
commits to its own log, so the model reading a run saw only each mount's
boundary — what went in, what came out — and could never say who wrote a value
inside `sf-tools` or `sf-injection-engine`. `inspect_subflow({ mount })` opens
that log by reference, with the same moves as `inspect_tool_run` (one shared
implementation): an inner overview, `find`, `variable`, one step, a step's
value, and — new for both tools — `key` alone for the last writer inside, with
footprintjs's reason codes folded from the subflow's own base. A nested subflow
opens one level at a time. Inner ids are said to be inner; an outer tool handed
one now answers with the mount to open instead of "unknown id", and a missing
inner log (no subflow results, a mount that never returned, a lean checkpoint)
is named, not silent. Keys a redaction policy NAMES stay redacted inside — the
subflow's log is scrubbed at commit like the run's. `run_overview`, `trace_node` and `who_wrote` add one line
naming the door — only when following it gives a true answer: a merge-back
under a renamed key names the mount without claiming a writer, and a
`beforeStageId` question considers only mounts that ran before the anchor — 98 characters on a planted-fact agent run's overview. Step-id
schemas drop their `enum` when subflows kept their own logs, so a pasted inner
id reaches that correction rather than a schema refusal.
