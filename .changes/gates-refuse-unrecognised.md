---
type: security
---
**Tool permission, pause and check-in handling hardened.** A permission checker's answer is now read by one rule everywhere it is asked, and the check-in evidence and pause records name what the run actually recorded. What an app will notice:

- A permission check that answers anything but `'allow'`, `'gate_open'`, `'deny'` or `'halt'` (for example `'ask'`, `'ALLOW'`, `'deny '` or `{}`) now refuses the call instead of running the tool; `permission.check` records it as `'deny'` with a rationale saying the answer was not recognised. Migration: make your checker return one of the four answers.
- The check-in evidence trail (`evidence.trail.toolCalls[].ok`) is now read from how each call settled, not from the first words of its result: a tool that threw, a call a middleware refused and a host's notice standing in for a result read `ok: false`; a tool whose text starts "declined by human" reads `ok: true`. Migration: none; read `ok` as "the call completed".
- A committed tool message in the history can carry a new field, `outcome` (`'refused'` or `'failed'`, absent when the call completed). It is never sent to a provider. Migration: a test that compares stored history byte for byte gains this field on calls that did not complete.
- A tool's own pause data (`pauseHere` / `askHuman`) can no longer set `toolCallId`, `toolName`, `checkIn`, `ask`, `awaitingInput` or `authorization`: the real call's id and name are written, and the other keys are dropped whatever their value. Migration: a tool that used one of these names for its own data must rename it.
- An AG-UI pause waits on the page only when the paused call is one of the app's `frontendTools`; a server tool that writes `agUiFrontendTool` into its pause data waits on a person. Migration: none for frontend tools built by `agUi({ frontendTools })`.
- The refusal of a pause raised while resuming now names the door it came through ("an approved ask", "granted credential consent"); the check-in sentence is unchanged. Migration: none.
