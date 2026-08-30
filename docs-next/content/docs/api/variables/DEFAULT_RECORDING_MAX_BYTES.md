---
title: DEFAULT_RECORDING_MAX_BYTES
---

# Variable: DEFAULT\_RECORDING\_MAX\_BYTES

> `const` **DEFAULT\_RECORDING\_MAX\_BYTES**: `5000000` = `5_000_000`

Defined in: [src/core/runbook/recording.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/recording.ts#L69)

The default size ceiling for a filed chart recording — 5,000,000 bytes.

Chosen against measured sizes rather than taste. A walk of a real triage run
is tens of kilobytes; this package's own field measurement of a full
`recordRun` bundle (one retrieval turn, vectors included) was 2.76 MB. Five
million bytes clears the realistic runbook by more than an order of
magnitude and still refuses the pathological one — a fleet sweep whose
commit log carries a row per subject per stage — BEFORE it lands in somebody
else's store under a retention budget they sized for tickets.

It is a declared number, not a magic one: it is named on the option, printed
in the refusal, and raised by whoever decides the whole bundle is worth it.
