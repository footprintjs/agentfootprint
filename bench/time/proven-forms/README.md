# Confirmable English time forms

Run the built-in English reader and resolver with a fixed message clock. Compare each unique, whole-phrase reading with independently specified UTC bounds, the exclusive cutoff, its precision and every expected minute from the existing UTC ruler. The benchmark runs offline.

| Form | Expected cells | Passed | Missed | Missing or duplicated |
| --- | ---: | ---: | ---: | ---: |
| Standalone elapsed look-back | 288 | 288 | 0 | 0 |
| Fully written clock range | 240 | 192 | 48 | 0 |

Only the six literal look-back phrases in [the manifest](manifest.mjs) passed in every measured context. The matrix crosses each phrase with four frozen anchors, three application zones and four independently started process zones. Anchors cover New Year, both Pacific clock changes and leap day with a fractional cutoff. The finite grammar includes `last 2 hrs`. Additional words, capitalization, durations, locales, zones or anchor contexts need their own evidence before widening qualification.

Keep confirmation for the range form. At every anchor and zone, the reader returned one whole but unreadable mention with zero parses for `2026-11-01 12:30 AM to 2:30 AM America/Los_Angeles`. On the clock-change day the two stated endpoints are unambiguous. The expected interval is 07:30 through 10:30 UTC, end excluded. The other four range phrases passed, including the spring clock change and the UTC year boundary. This benchmark records reader behavior. The production decision to skip confirmation, its saved-turn checks, and full/delta replay belong to the separate runtime change.

## Reproduce

From a checkout with the repository dependencies available, run:

```sh
node --test bench/time/proven-forms/verify.test.mjs
node bench/time/proven-forms/run.mjs /tmp/proven-forms.json.gz
gzip -dc /tmp/proven-forms.json.gz | less
```

[The receipt](results.json.gz) contains each expected and actual interval, or the reader's reason for a miss. The separately pinned [identity](identity.json) binds the reader and ruler source, finite grammar, expected matrix, Node, ICU and timezone-data versions. A different runtime can produce measurements but cannot qualify against this identity. The verifier checks the exact expected IDs and bounds before counting by form. Its tests remove and duplicate rows, change a bound and change the runtime identity. The eight excluded contexts exercise the benchmark classifier. They make no assertion about production checkpoint admission.
