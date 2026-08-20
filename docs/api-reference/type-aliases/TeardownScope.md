[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TeardownScope

# Type Alias: TeardownScope

> **TeardownScope** = `"call"` \| `"run"` \| `"session"` \| `"shutdown"`

Defined in: [src/core/toolSessions.ts:81](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/toolSessions.ts#L81)

How long a registered cleanup is allowed to live.

 - `'call'`     — until `tool.execute` settles (resolve OR throw). Available
                  at every door, including `mcpServe`, where a served call is
                  the only unit there is.
 - `'run'`      — until the run reaches a terminal that is NOT a pause.
                  **A pause is not a terminal**: a check-in on a code
                  interpreter is a person deciding, and tearing the sandbox
                  down there destroys the exact state the resume needs.
 - `'session'`  — until the composition root says the hosting session ended
                  (`agent.closeToolSessions({ sessionId })`). Nobody but the
                  composition root can know that: a request/reply deployment
                  has no end-of-session signal, and inventing one would be a
                  library guessing about somebody else's protocol.
 - `'shutdown'` — until `agent.shutdown()` (which `standingAgent`'s close
                  calls). The backstop under all three.
