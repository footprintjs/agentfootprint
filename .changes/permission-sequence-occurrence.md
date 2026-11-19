---
type: fixed
bump: patch
---
**Corrected result attribution in permission-checker call sequences.** When a
tool-call ID repeated, the sequence could list a refused or unanswered call as
dispatched, or omit a call that ran. IDs can repeat when a fresh process resumes a
saved run with an adapter that generates IDs locally. Custom checkers that
use the order or count of calls in `sequence` could make a decision from the
wrong sequence. The built-in role allowlist bases its decisions on role,
capability, and target, so its decisions were unaffected.
Recorded non-entry and input cancellation now keep those calls out of the
permission sequence, regardless of their display text.
When findings are off, a custom `tellLLM` refusal can still appear in
`sequence`, so enable findings or start the refusal text with
`[permission denied:` to keep it out.
