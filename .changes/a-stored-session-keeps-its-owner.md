---
type: security
---
**A stored conversation keeps its owner when it is saved mid-run.**

- With `durability: 'sync'` or `'async'`, progress saves now carry the same owner as the completed turn. If a signed turn fails after saving progress, its owner can continue from the saved row at a door with an identity verifier. Other signed users and anonymous callers at a door configured with `allowAnonymous` receive `ERR_SESSION_NOT_FOUND`. When a session store rejects a save by a different signer, the host reports `ERR_SESSION_OWNERSHIP_CONFLICT` in every durability mode and leaves the stored conversation intact.
- At a door without an identity verifier, `session-pending` now returns `ERR_SESSION_NOT_FOUND` when the caller and the stored conversation's envelope name different users. A caller who names nobody can still retrieve the waiting question using the session id. A store that keeps ownership outside the envelope (`agentEngineSessions`) can refuse to save an answer to a question this read served, and a shared ownership check through the store port is deferred to a major release.
- `agentEngineSessions` marks a newly created anonymous session in its stored state and remembers the first signer across later anonymous writes. It refuses another signer with `ERR_SESSION_OWNERSHIP_CONFLICT`. A signed save receives `ERR_SESSION_NOT_FOUND` if a legacy row sits under the anonymous placeholder and its envelope names nobody, or if an anonymous-placeholder row has an unreadable owner mark. A legacy row under the anonymous placeholder whose envelope names an owner can still be saved by that owner. Anonymous writes to legacy ownerless rows still work.
- `agentEngineSessions.listByUser` can recover a usable id for some older rows. It omits a legacy row if the store rewrote its id and the conversation names no id that opens the row. A row can still be opened directly if its original id resolves to it.

The core stored conversation has no explicit marker for a session that began anonymously. Its existing ownerless rows remain indistinguishable from rows that previously lost their owner. A verifying door still refuses access to those rows for every signed caller, while an anonymous caller can still open them with `allowAnonymous`.

The explicit anonymous marker for core conversations and the count of rows omitted by `listByUser` are deferred to a major release because each requires a public type change.
