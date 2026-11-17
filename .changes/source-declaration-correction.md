---
type: added
---

**Correct an omitted argument-source declaration once before asking the person.** Opt in with `inputsLayer({ argumentSources: true, declarationCorrection: 'once' })`. The native batch barrier holds every proposed tool call, asks the model for an actual source declaration and verifies its new proposal through the existing checks. False or malformed claims and genuinely missing values keep their human-question or refusal path. The allowance survives same-request pause/crash recovery and resets on a new human turn; framework notices never become source evidence.
