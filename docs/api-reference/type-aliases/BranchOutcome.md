[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BranchOutcome

# Type Alias: BranchOutcome

> **BranchOutcome** = \{ `ok`: `true`; `value`: `string`; \} \| \{ `error`: `string`; `ok`: `false`; \}

Defined in: [src/core-flow/Parallel.ts:94](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core-flow/Parallel.ts#L94)

Outcome per branch in tolerant mode. One of:
  - `{ ok: true, value: string }` — branch succeeded; `value` is the returned string
  - `{ ok: false, error: string }` — branch threw; `error` is the error message

Consumers in tolerant mode receive `Record<branchId, BranchOutcome>` and
decide how to handle partial failure (e.g., fall back to a default,
log, retry, or surface a user-facing message).
