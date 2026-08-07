[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BranchOutcome

# Type Alias: BranchOutcome

> **BranchOutcome** = \{ `ok`: `true`; `value`: `string`; \} \| \{ `error`: `string`; `ok`: `false`; \}

Defined in: [src/core-flow/Parallel.ts:93](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/core-flow/Parallel.ts#L93)

Outcome per branch in tolerant mode. One of:
  - `{ ok: true, value: string }` — branch succeeded; `value` is the returned string
  - `{ ok: false, error: string }` — branch threw; `error` is the error message

Consumers in tolerant mode receive `Record<branchId, BranchOutcome>` and
decide how to handle partial failure (e.g., fall back to a default,
log, retry, or surface a user-facing message).
