---
type: added
---
**A packed recording is expanded only when the plain recording it stands for fits a bound.** A
packed recording can stand for far more JSON than it holds — a value referred to ten times, by
values each referred to ten times, is a few KB packed and billions of bytes unpacked — and every
reader that walks the result as a tree (the answer account's fold, the trace toolpack's previews,
any `JSON.stringify`) does that much work. `unpackRecording(value, { maxBytes })` now measures the
plain size over the PACKED form — each pooled value once, so the check costs the packed size — and
refuses with `PackedRecordingTooLargeError` (a `PackedRecordingError`) before anything is built.
The default, `DEFAULT_UNPACK_MAX_BYTES`, is 512 MiB: about the largest plain recording a JavaScript
string can hold. The answer-account op holds a packed recording to its `maxRecordingBytes` on the
recording it stands for, so an oversized one gets the same `RecordingTooLargeForAccountError` (413)
as its plain twin; `openRecording` reads through the default. Found in review before the packed
format shipped: without the bound, a few KB stored under the account ceiling could stand for a
recording the ceiling exists to refuse.
