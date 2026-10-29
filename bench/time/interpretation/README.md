# bench/time/interpretation: does a time phrase lead to the window the person meant, or to a question?

The measurement behind [the time interpretation design](../../../docs/design/2026-10-time-interpretation.md),
with every result in [its measurement page](../../../docs/design/2026-10-time-interpretation-measurement.md).
It runs five English time readers over labelled phrases and counts two numbers apart, never merged:

- **wrong readings** — a window or scope the person did not mean was read, or the tool's default stood
  in for a time the person named;
- **unnecessary clarifications** — the person was asked although one exact reading existed.

It is not part of the published package. It costs nothing to run: no model is called.

```sh
cd bench/time/interpretation
npm install                                  # three pinned dev dependencies, this folder only
npm run build-reader                         # bundles englishTimeReader from this repository's src/
TZ=UTC node scripts/run.mjs existing --duckling-replay   # re-score from Duckling's recorded answers
TZ=UTC node scripts/run.mjs heldout  --duckling-replay
TZ=UTC node scripts/run.mjs regressions --duckling-replay
npm run acceptance                           # the scope digest's acceptance cases (design § 8.4, R15)
# a live run asks a local Duckling server instead:
#   docker run -d --name time-eval-duckling -p 127.0.0.1:18000:8000 rasa/duckling
#   TZ=UTC node scripts/run.mjs existing
```

## Files

| File | What it is |
|---|---|
| `corpus/app-corpus.json` | the host app's time corpus, 269 phrases with the host app's own labels (reads N minutes, ask, none). Four rows named products; they carry generic nouns here ("release 9.5", "firmware 9.7", "node id 3"). |
| `corpus/meaning.json` | the meaning label of the whole request where the host app asks for its grammar's sake (47 entries, written against an earlier version of its corpus; 45 still differ from its labels), and the five added cases |
| `corpus/sampling.json` | the existing-corpus rows that carry a sampling instruction |
| `corpus/current.json` | the rows that ask for the current state ("right now", "at the moment") |
| `corpus/regressions.json` | the 22 cases an independent review ran against the prototype, with that review's expectations; reported apart, never merged into the frozen sets |
| `corpus/heldout.json` | 80 phrases written blind, before any reader ran on them; never edited since |
| `corpus/heldout.fixed.json` | its SHA-256 and the time it was fixed |
| `corpus/tool-profiles.json` | what the measured tool declares: its terms, its shape, and no sampling |
| `scripts/adapters.mjs` | one adapter per reader, mapping its own output to one shape, with no word list of its own |
| `scripts/signals.mjs` | the leftover scan and the closed lookback grammar (a prototype) |
| `scripts/meaning-rule.mjs` | the complete-meaning rule: bounded interpretation over a closed set of relations (a prototype) |
| `scripts/binding.mjs` | the scope digest: every argument the call sends is bound unless the app's local declaration marks it `inert` or `continuation` (a remote declaration's marks are ignored), read from the call's own keys into a null-prototype record, so an argument named `__proto__` is bound too. Every argument is checked as JSON data first, exempt ones included, without running a getter; anything else, a cycle, or data past the bounds is refused; `atDispatch` hands back the checked copy, which is what runs (a prototype) |
| `scripts/acceptance.mjs` | the digest's acceptance cases: a tool with no `Tool.search`, an `inert` argument, a partial declaration, sampling, batches, refusal, an argument named `__proto__` parsed from JSON, JSON data only (an accessor, a `Date`, a function or an inherited prototype is refused, and no getter runs), a local `continuation` (page 2 of a confirmed call runs; with a changed customer it asks again; from a remote declaration, or without the role, a page change asks again), and validate-first for `inert` and `continuation` alike (a getter on the exempt argument is refused without running; an exempt non-JSON value or a cycle is refused; what runs is the checked copy), plus a cycle or data past the bounds refused, never a thrown `RangeError`. Batch membership is tested only as a digest change; the real batch ask and its resume are not built, so they are not measured here |
| `scripts/run.mjs` | the runner and the scoring |
| `scripts/build-reader.mjs`, `scripts/versions.mjs`, `scripts/bundle-sizes.sh`, `scripts/probe.mjs` | the reader build, the version record, the bundle sizes, a probe of native output |
| `scripts/extract-corpus.mjs` | how the host app's corpus was read out of its test file (that file is not public) |
| `results/{existing,heldout,regressions}-{table.md,summary.json,rows.json}` | the tables, the counts, and every phrase's mentions, outcomes and verdicts |
| `results/raw/` | each reader's own output for every phrase; `--duckling-replay` re-scores from it |
| `results/versions.json` | every version the run depends on |
| `results/lock-evidence.txt`, `results/first-run/` | how and when the held-out set was fixed, the frozen script hashes, and the first held-out run |

## What is scored

Each phrase has a meaning label for the whole request. The expected outcome is that label, except
that two kinds of request ask: one with a sampling instruction, and one asking for the current
state ("right now"). Neither tool profile declares that its tool executes sampling or reads the
current state, and recognising the words would not apply them to the query. Read as a plain
window or as the default, either is a wrong reading here.

The score compares windows only: a read's length against the label. There is no representation of
the call's arguments, so it cannot judge which target a call binds. The regression set marks those
cases `inspect` and does not score them; the design binds them in the confirmation instead.

The modes add one layer at a time: the reader's value alone; its own structure; the leftover scan;
quote agreement; and the complete-meaning rule under each tool profile. `run.mjs` explains each one.

## The held-out set, plainly

- One person wrote the held-out phrases, all the labels, the prototype scan, the grammar and the
  rule. The set was blind to every reader, and was fixed by hash and committed before the first run.
- The first run (`results/first-run/`) was the only blind one. The complete-meaning rule was
  specified after it, in answer to one of its phrases (H23), and revised again (version 2.0.0) after an
  independent review found requests it still accepted wrongly. Neither later round is blind.
- The tool profile `plus-held-out-nouns` adds the metric and target nouns the held-out phrases use.
  It adds no word that restricts a read, and it can only turn asks into reads.
- The next set should be written by someone else, before it sees any reader, the scan or the rule.

## The reference row

The host app's own rule is a reference row: its word scan with the library's reader, **as it stood
at the host app's commit `0d52b9b` (2026-10-28)**. It is a historical baseline. The reviewer reports
that the host app's current rule refuses the three held-out cases counted against the measured rule
(H16, H23, H31); this bench did not rerun against the current rule, which is the host app's side. Its
module is the host app's private code, so it is not in this folder. When `--reference <module>` points at
a copy, the row is added. Its job is to reproduce the host app's own labels (0 wrong readings and 0
unnecessary clarifications against them, which checks this harness) and to compare. The committed
results include that row, measured locally. A run without the module drops the row; everything
else is byte-identical.
