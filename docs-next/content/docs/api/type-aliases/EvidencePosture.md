---
title: EvidencePosture
---

# Type Alias: EvidencePosture

> **EvidencePosture** = `"assist"` \| `"guard"` \| `"rails"`

Defined in: [src/core/agent/evidence/types.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L28)

How hard the check pushes back. **Same three words as the skill-graph
routing dial, deliberately** — one posture vocabulary across the library —
but a SEPARATE option, because routing authority and evidence discipline are
different decisions and an app may legitimately want strict routing with
loose evidence (or the reverse).

  • `'assist'` — **the default.** Record and flag. The answer goes out
    exactly as the model wrote it; nothing loops, nothing is withheld. Pure
    observability: you learn how often it happens before you decide to act.
  • `'guard'` — in-loop correction. The unsupported values are named back to
    the model, it gets ONE more turn, and if they survive that turn the
    answer ships flagged. This is the posture that makes a small model
    behave like a bigger one, and it is the recommended setting for weaker
    models.
  • `'rails'` — `'guard'` plus a refusal: if the values survive the one
    revision, `run()` raises instead of returning the answer.
