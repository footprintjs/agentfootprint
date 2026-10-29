---
title: CodeRunReason
---

# Type Alias: CodeRunReason

> **CodeRunReason** = `"service-error"`

Defined in: [src/provider-contract/types.ts:1387](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1387)

Why an outcome is not an exit status, when the runner can say. One value:

`'service-error'` — the backend flagged its answer as an error and reported
NO exit status, so whether the code ran at all is not confirmed. That is not
a program that failed: a program that ran and failed has an `exitCode`.
