---
type: added
---
**Packed recordings: every repeated value written once, so a long run can be saved at all.** A
plain recording repeats the conversation once per place that saw it, so its JSON grows with the
square of the iteration count — with 1,000-row tool results, 67 MB at 10 iterations, 808 MB at 40,
and past JSON's string limit (not mintable) before 80. `packRecording(recording)` (from
`agentfootprint/observe`) writes each repeated value once and refers to it by index: the same runs
are 1.3 MB, 5.6 MB and 12.6 MB at 80, and 4× the iterations cost ~4× the bytes.
`unpackRecording(value)` reads both shapes — a plain recording comes back untouched — and the law is
exact: unpacking the packed JSON gives back the plain wire JSON byte for byte. A packed format this
reader does not know is refused by name (`PackedRecordingError`), never half-read; `isPackedRecording`
and `PACKED_RECORDING_FORMAT` (`'agentfootprint.recording.packed.v1'`) name it. `openRecording` and
the answer-account op read packed recordings, and an Agent mints its artifact recordings packed with
`artifacts: { recordings: { packed: true } }` — off by default, so readers such as the Lens adopt
`unpackRecording` before a writer packs.
