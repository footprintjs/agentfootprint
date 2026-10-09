---
title: NoConversationReason
---

# Type Alias: NoConversationReason

> **NoConversationReason** = `"never-run"` \| `"last-run-unfinished"` \| `"last-input-refused"`

Defined in: src/core/conversation.ts:220

Why `followUp()` found no conversation to continue.

- `'never-run'` — no run on this agent got past input admission yet
  (before the first run, or when the first turn was refused).
- `'last-run-unfinished'` — the last run ended without an answer (it threw);
  its conversation rides `RunCheckpointError.checkpoint`.
- `'last-input-refused'` — input middleware refused the last run's message.
  A refusal raises `MessageDeniedError`, which carries no checkpoint: the
  refused attempt admitted no conversation, so the one to continue is the
  checkpoint taken after an earlier ACCEPTED run.
