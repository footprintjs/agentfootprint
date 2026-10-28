---
type: internal
---
**Make the paused-session isolation test deterministic.** Reproduce a legitimate consent identifier containing the old short marker, and check for a distinct session secret that cannot occur in a hexadecimal identifier. Keep the whole-record leak check and the pause, conversation and single-resume assertions. No runtime behavior changes.
