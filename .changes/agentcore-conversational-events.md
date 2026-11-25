---
type: added
---
**Choose extractable AgentCore memory events per entry.** `AgentCoreStore` accepts
a synchronous `eventPayload` selector for explicit conversational role/text or
the existing blob format. A conversational event keeps the original entry blob
in the same request, preserving entry reads and versions. Unsupported clients
and serializers, invalid projections and oversized conversation payloads are
refused before the write, without truncation or a new adapter retry.

Each batch request receives detached namespace fields, so a custom client cannot
redirect later writes by replacing the configuration it was handed. An omitted
selector does not inspect the new conversational capability metadata.

Event acceptance does not prove extraction completed. Entry deletion, session
forget and local entry TTL do not erase already-derived long-term records;
`extraction: 'skip'` applies only to the current event. SDK transport retry policy
is unchanged.
