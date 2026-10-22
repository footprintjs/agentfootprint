---
title: ResumeDecisionRefusal
---

# Type Alias: ResumeDecisionRefusal

> **ResumeDecisionRefusal** = `"no-request"` \| `"request-not-recorded"` \| `"other-request"` \| `"call-changed"` \| `"already-answered"`

Defined in: [src/core/pause.ts:375](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L375)

Why a decision could not answer the request a run is paused on — the
[ResumeDecisionError](/docs/api/classes/ResumeDecisionError) `reason`:

  - `'no-request'` — the decision names no request (`requestId` missing):
    one built by an older release, or by hand.
  - `'request-not-recorded'` — the PAUSE recorded no request to answer: a
    checkpoint written before requests were named, or one whose record was
    removed.
  - `'other-request'` — the decision names a different request: another
    conversation's, an earlier pause of this run, a parallel sibling's.
  - `'call-changed'` — the decision names this request, but the paused call
    is no longer the one the person was asked about (the checkpoint's tool,
    arguments, call id, served party or middleware position changed).
  - `'already-answered'` — a resume already used a decision for this
    request, approved or declined.
