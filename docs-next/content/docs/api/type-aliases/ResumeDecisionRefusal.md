---
title: ResumeDecisionRefusal
---

# Type Alias: ResumeDecisionRefusal

> **ResumeDecisionRefusal** = `"no-request"` \| `"request-not-recorded"` \| `"other-request"` \| `"call-changed"` \| `"chain-changed"` \| `"already-answered"` \| `"closed-by-host"`

Defined in: [src/core/pause.ts:387](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L387)

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
    arguments, call id, served party, or — for an ask — the middleware
    position or the rules recorded after it changed).
  - `'chain-changed'` — an ask only: the decision names this request and
    the checkpoint is intact, but the agent resuming it would continue the
    middleware chain under other rules than the ones the person was asked
    under — the link that asked, or a link after it, was removed, added,
    renamed or moved (a redeploy). An approval holds for the rules it was
    given under, so a rule it was given under is never skipped.
  - `'already-answered'` — a resume already used a decision for this
    request, approved or declined. Whether that resume finished — and so
    whether the call ran — is not known to the one refused.
  - `'closed-by-host'` — a host that kept the pause closed it, because no
    answer could reach it any more, and proved its call never ran: it spent
    the request in the ledger the request was minted under, so no decision
    can run it. The call did not run, and nothing ran now.
