---
type: breaking
bump: major
---

**A tool call approved before a wait can be refused when it resumes.** Before running the approved call, the agent asks its permission checker and tool middleware again about the approved arguments. If a policy needs another human answer, the resumed call is refused. The person is asked again only if the model calls again. A tool middleware response the library cannot recognize also results in a library refusal.

Migration: Finish paused runs before upgrading, because a tool approval from an earlier version lacks the gate record required to resume. Removing or renaming a before-tool link, or removing the permission checker used before the wait, refuses the resumed call. A link that rewrites arguments sees its own output when asked again and must leave it unchanged for the approved call to run. A middleware question that uses an artifact ticket can reuse the approval for the same ticket on the same call. Keep the ticket for that call or use inline props, since minting a fresh ticket changes the question. Handle a refusal on resume even when a person already approved the call.

Keep credential consent checkpoints in trusted storage because the resume relies on them for the suspended arguments and the original gate record.
