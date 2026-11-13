---
title: EVIDENCE_CHECK_FRAME_PREFIX
---

# Variable: EVIDENCE\_CHECK\_FRAME\_PREFIX

> `const` **EVIDENCE\_CHECK\_FRAME\_PREFIX**: `"[evidence check"` = `'[evidence check'`

Defined in: [src/lib/saidByPerson.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/saidByPerson.ts#L114)

Opening of the authored frame the evidence gate once wrote into the
 conversation as a `role: 'user'` turn. Nothing writes it now: the revision
 request travels as request-only system context instead. Still recognised,
 because a stored conversation from an older release holds it, and that turn
 must not be read as the person's words. Stable — tests, docs and readers
 match on it.
