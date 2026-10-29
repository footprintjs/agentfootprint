---
title: ScriptLabel
---

# Type Alias: ScriptLabel

> **ScriptLabel** = `"submitted"` \| `"returned"` \| `"reported-success"` \| `"reported-failure"` \| `"completed"` \| `"completed-with-failure"` \| `"outcome-unknown"`

Defined in: [src/lib/scriptRecord.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L39)

What the record proves about one call of a code-running tool — read from
the runner's EXECUTION evidence first, then from the call's SETTLEMENT, and
never from result delivery (`core/agent/scripts/label.ts` · `scriptLabelOf`):

- `submitted` — the program is on the record and the call has not returned
  (never dispatched, refused before `execute`, or still open). Never "did
  not run".
- `returned` — the tool returned and the record holds no execution evidence:
  the tool filed no runner facts, or facts that report no outcome. The call
  completed; nothing proves the program ran.
- `reported-success` / `reported-failure` — the runner's bare verdict, with
  no exit code: no claim that the program ran to an exit.
- `completed` — an explicit exit code 0.
- `completed-with-failure` — an explicit non-zero exit code: the program
  reached an exit; what it did before is not known from the exit.
- `outcome-unknown` — no runner facts after a timeout, a cancellation or a
  thrown error, or a service error with no exit code.

A reader must not promote a label to its neighbour.
