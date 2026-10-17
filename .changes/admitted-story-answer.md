---
type: fixed
---
**The Story recorder shows a governed answer only when it is delivered.** Output middleware and answer validation withhold the draft `llm_end` content; a withheld model draft no longer creates an empty or premature answer beat. The recorder keeps that call's cost, tool menu and reasoning until delivery at `turn_end`, then records the delivered canonical `finalContent` at its actual final stage. Refused or superseded attempts create no delivered-answer beat. Validation's observe mode still delivers the candidate with its report. Ungoverned answers retain their existing content and stage attribution.
