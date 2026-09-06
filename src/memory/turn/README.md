**Support** — which turn of a conversation is about to happen, decided in one
place.

## What it reads / what it writes
- Reads the conversation's stored entries.
- Writes nothing; it returns a number. Every memory kind turn-stamps its ids
  from this one rule, so two turns of one conversation cannot collide.

## The one law here
One rule, shared. A second implementation of "which turn is this?" would make
two entries claim one id.

## Files
- `resolveTurnNumber.ts` — the rule.
- `index.ts` — the door.
