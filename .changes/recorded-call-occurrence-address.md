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
Use a complete text marker when checking records for leaked text, since a short
run of digits can also occur inside an address.

A cache strategy or a provider adapter can no longer change the saved record.
Each model call hands the `CacheStrategy` its own copy of the request and
passes what the strategy returns to the provider as it is. Before, an edit
made in place to that request could reach the history the run saved.

Automatic native output keeps the format requirement selected for each call
when an adapter adds or removes a format in place, including runs without a
signal and streams that fall through to a completion.
