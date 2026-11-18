---
type: breaking
bump: major
---

**A tool call approved before a wait can be refused when it resumes.** Before running the approved call, the agent asks its permission checker and tool middleware again about the approved arguments. If a policy needs another human answer, the resumed call is refused. The person is asked again only if the model calls again. A tool middleware response the library cannot recognize also results in a library refusal.

Migration: Keep the tool policies used for admission available when restoring a waiting run. A middleware that asks the same question about the same approved call can keep returning that question. Handle a refusal on resume even when a person already approved the call.
