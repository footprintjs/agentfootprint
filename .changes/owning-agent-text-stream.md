---
type: fixed
---
**Finish the root reply in text SSE when an Agent mounts another Agent.** A
fresh `toSSE({ format: 'text' })` stream now delivers the owning Agent's
answer and closes at its marked turn end. The same rule applies to a text
stream that stays open across a pause.
