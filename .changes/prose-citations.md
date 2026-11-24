---
type: added
---

**Check citations in ordinary prose answers.** Opt in with `Agent.create({ citations })` to link an answer to authorized tool results submitted by the plain Anthropic SDK adapter. Authored rules can verify a scoped claim, report a disagreement between two same-scope tools, or flag a requested column missing from the cited result's complete visible schema. Read the citation findings from the answer assessment.
