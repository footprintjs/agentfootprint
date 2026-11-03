**Support** — decode one stored AgentCore session blob.

`decodeBlob.ts` holds the existing decode step used by `../agentcore.ts`.

The law: non-string inputs keep their identity; JSON text becomes an object only when it decodes to one. An unreadable or non-object JSON value stays as its original bytes so the adapter's envelope check can refuse it.
