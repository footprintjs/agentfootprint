---
type: added
---
**Save repeated model context once and record each call as a change list.**
Opt-in context recording uses a value-table port, preserves served text and
schema values, and keeps provider requests unchanged. Expansion refuses
missing values and malformed references; ordinary recordings still read as
before. Commentary now gives every registered event a sentence or an explicit
internal exclusion instead of a bare event label.

Migration: unknown custom events now use the `event.unknown` prose key instead
of falling through to a raw payload renderer. Existing template override keys
keep their meanings.
