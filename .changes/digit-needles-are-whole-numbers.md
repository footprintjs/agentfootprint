---
type: internal
---
**Tests look for a short hidden number as a number of its own.** Seven tests asserted that a short run of digits was absent from serialised text that also holds hashes, ids or timestamps, so they could fail by chance. Each now looks for the number with no digit on either side and, where the test hides a longer value, for that whole value too. The 1025-call batch test gets an explicit timeout. No behaviour changed.
