---
title: placedResultKind
---

# Function: placedResultKind()

> **placedResultKind**(`toolName`, `declared?`): `string`

Defined in: [src/artifacts/placement.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/placement.ts#L95)

The kind vocabulary a placement mint declares — THE one decision, and the
only place it is made.

Default: `tool-result/<toolName>`. Honest — it says exactly what the payload
is and which tool produced it — and it is what a `wants` declaration or a
`present` call names to consume the placed result.

`declared` is the tool's own `Tool.resultKind` (9.70.0), and when a tool
declares one it WINS. The reason is the exact-match law on the consuming
end: `wants` matches kinds by exact string equality — no wildcards, no
hierarchy — so the framework's default vocabulary is a ticket a
`wants: { dataset: 'dataset/rows' }` argument must refuse. Rather than
loosen the matcher (a ticket would stop being a promise) or make consumers
re-mint at the seam (the framework declining to carry its own ref), the
MINT speaks the author's vocabulary. Absent → today's bytes exactly.

## Parameters

### toolName

`string`

### declared?

`string`

## Returns

`string`
