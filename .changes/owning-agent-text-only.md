---
type: changed
---
**Keep mounted drafts out of an Agent's text stream.** With
`toSSE({ format: 'text' })`, fresh and resumed streams skip tokens from mounted
Agents so a chat client sees the owning Agent's text. Mounted tokens are
available in full event frames and in scoped record-only AG-UI messages.
