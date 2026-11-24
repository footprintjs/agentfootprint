---
type: added
---
A host that sets `hostEndedTurns: true` at agent construction can end a turn at admission with `agent.endTurn({ reply, reason: 'host-cap' })`. The run checks the reply against its output policy and records who supplied it. Conversation checkpoints preserve that origin across restarts. The next model request receives the conversation text with the private origin field removed.
