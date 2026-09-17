---
title: LIBRARY_AUTHORED_PREFIXES
---

# Variable: LIBRARY\_AUTHORED\_PREFIXES

> `const` **LIBRARY\_AUTHORED\_PREFIXES**: readonly `string`[]

Defined in: [src/lib/saidByPerson.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/saidByPerson.ts#L122)

Every opening this library puts on a `role: 'user'` message it wrote itself.

The registry, not a convenience: this is the list a reader has to have ALL
of to answer "did a person say this?", and until 9.84.0 no reader had it —
the window held two entries, the evidence gate held the other two, and the
routing layer could reach neither. A new authored frame belongs here on the
day it is written.

The two correction frames both QUOTE untrusted text after their label (a
validator's error, the model's own flagged values), which is exactly why
they are matched by PREFIX and never by anything further in. The nudge is
the same shape for a different reason: its body is a list of a skill's own
step notes and tool names, which is exactly the text a rule watches for.

The list is frozen because it is a registry, not a scratch array: a consumer
holds the same object this library's own readers hold, and a `push` into it
would change what every reader calls a person's message.
