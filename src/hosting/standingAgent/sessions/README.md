# Stored session history

`history.ts` owns history listing, transcript reads and the shared ownership
predicate used before a turn or artifact read. It reads the store, not a lane,
and keeps foreign and missing transcripts indistinguishable. Its tests pin the
identity requirement and refusal before a store read.
