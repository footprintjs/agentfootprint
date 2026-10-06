---
title: NoConversationReason
---

# Type Alias: NoConversationReason

> **NoConversationReason** = `"never-run"` \| `"last-run-unfinished"` \| `"last-input-refused"`

Defined in: [src/core/conversation.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/conversation.ts#L171)

Why `followUp()` found no conversation to continue.

- `'never-run'` — this agent has not completed a run.
- `'last-run-unfinished'` — the last run ended without an answer (it threw);
  its conversation rides `RunCheckpointError.checkpoint`.
- `'last-input-refused'` — input middleware refused the last run's message.
  A refusal raises `MessageDeniedError`, which carries no checkpoint: the
  refused attempt admitted no conversation, so the one to continue is the
  checkpoint taken after the last ACCEPTED run.
