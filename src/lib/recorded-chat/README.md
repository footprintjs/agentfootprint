**Mixed** — one session's turns, each walked and then FROZEN as its own evidence
the moment it finishes.
Walker: `send()` runs one turn through the consumer's agent factory.
Trace: it freezes that turn's evidence immediately, per turn — `types.ts` names
the three traps it owns.
Fold / Lens: `reason(k)`, `rerunTurn(k)` and `fork(k)` compose over
`../context-bisect/`'s existing surface rather than duplicating it.

## What it reads / what it writes
- Reads the agent's own recording for the turn that just ended.
- Writes a per-turn frozen record, so "why did turn 3 answer that?" reads a
  trace turn 4 cannot have overwritten.

## The one law here
Evidence is frozen at the turn boundary. A later turn may add records; it may
never edit an earlier one.

## Files
- `recordedChat.ts` — the session recorder.
- `types.ts` — the shapes, and the three traps.
- `index.ts` — the door.
