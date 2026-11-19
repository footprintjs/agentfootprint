---
type: added
---
**Saved evidence can identify a specific tool call when IDs repeat.** New
recordings keep an opaque call address on tool results, events and evidence
rows. Readers use that address through a pause and after the history is
trimmed. Saved recordings from before this change remain readable.

The address holds random words. Two runs of the same script record different
addresses, so a test that compares the events or records of two runs must
leave `callOccurrenceKey` out of the comparison. Nothing sent to a provider
changes.
