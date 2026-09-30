---
type: fixed
---
**The evidence check no longer accuses a person's own date or clock time of being invented.**
A person who answered a typed ask (`requestInput`) with the date `2026-10-09` after
asking about "8 Am to 8:40 AM" saw an answer that said "8:00 … 2026" marked
"2 values not traced". Three gaps, fixed at the root in the exempt corpus
(`src/core/agent/evidence/evidenceIndex.ts`):

- **A typed ask's answer is the person's words.** It lands as a tool result, so
  it used to be read as a tool observation — windowed like one and missing from
  a compaction summary's lineage. The fields the person answered are now exempt
  like their message (after the redaction rules, carried by a fold's lineage);
  the fields the asking tool supplied stay the tool's.
- **A date keeps its parts.** An ISO date the person or app wrote also exempts
  its year, month and day — `2026-10-09` exempts `2026`. Slash spellings are not
  produced (their order is a locale).
- **A clock time keeps its spellings.** `8 Am` exempts `8:00` and `08:00`;
  `20:00` exempts the `8:00` of `8:00 PM`; a pm time is never read as its am
  twin. Durations (`2h`) are never read.

The tool-evidence index is not widened: a tool's timestamp still does not
ground a year the answer invented, and an invented `9:15` or `2031` is still
flagged. A run with no date or clock time builds exactly the corpus it did.
