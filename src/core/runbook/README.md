# runbook — procedures as tools, answers as evidence

`runbookAsTool` wraps a footprintjs chart as one Agent tool whose every
answer carries the **mandatory honesty spine**: the coverage ledger (inner
tools' ledgers folded upward), provenance re-emitted first, the rule set's
name + version, and the recorded walk as an artifact ticket
(`recording/chart-walk`). An optional verdict/rowset projection is selected
by `resultKind: 'verdict/*'`.

One file per job:

- `types.ts` — the options bag and the envelope (spine + projection).
- `runbookAsTool.ts` — the bridge: fresh executor per call, narrative
  recorder, envelope assembly, absence pass-through, kept records.
- `dispatch.ts` — the wrapper over `ctx.tools`: records every inner outcome
  for the coverage fold; an inner absence short-circuits unless the call
  site declared `{ allowAbsent: true }`.
- `coverage.ts` — the three-source ledger fold (inner ledgers, the chart's
  `coverage` state key, the bridge's own entries) + the sentence.
- `walk.ts` — the projection law (control flow survives the cap), truthful
  counters, the guarded mint (a failed mint costs the ticket, never the
  answer).
- `recording.ts` — the OPT-IN chart recording (`walk: { recording }`): the
  inner chart's own `{ snapshot, events, structure }` filed under
  `recording/run` beside the walk, so the row projection can actually be
  DRAWN (`structure` is the only route to a graph, and no snapshot carries
  it). Three laws: the snapshot comes from the REDACTED mirror, so one
  `redact` policy means the same for both artifacts; a bundle over the byte
  ceiling is REFUSED, never truncated (a walk's rows are independently
  meaningful, a recording is one bundle); and every absence — no store, over
  size, unserializable, a store that threw — is SPOKEN in
  `walk.recording_note` rather than left as a missing field.
- `verdicts.ts` — the rowset off the `verdicts` state key, the one-cap
  table, the two render laws (`VERDICT_RENDER_NOTE` / `PANEL_RENDER_NOTE`),
  and meanings GENERATED from declared branches + observed rule labels.
- `report.ts` — the precedence law: the chart's `report` is admitted BESIDE
  the envelope's own names, never over them; a refused field is named in
  `report_note` rather than dropped in silence.

## Who renders the rowset — `presentation`

A rowset can have a surface other than the model's prose. In a chat client it
cannot: the words are the only place the rows can appear, so the table ships
pre-rendered and the model is told to output it verbatim — retyping is the
alternative, and a retyped identifier that looks right and matches nothing is
the failure the note exists to stop. In a client that draws the rowset itself —
a data panel, a grid, a report page — the reader is *already looking at the
rows*, and asking for them again in prose runs the same transcription risk for
no gain.

The bridge cannot see which client it is in. The caller says:

```ts
// DEFAULT — prose is the rowset's only surface.
runbookAsTool({ name: 'backup_triage', description, procedure, resultKind: 'verdict/backup-posture' });
// result: { verdicts, rows_shown, rows_total, rows_complete,
//           table: '| subject | verdict | …', render_note: VERDICT_RENDER_NOTE, … }

// PANEL — the host tickets and draws this rowset itself.
runbookAsTool({ …, presentation: 'panel' });
// result: { verdicts, rows_shown, rows_total, rows_complete,
//           render_note: PANEL_RENDER_NOTE, … }     ← no `table` key at all
```

`verdicts`, `rows_shown`, `rows_total`, `rows_complete` and `verdict_meanings`
are byte-identical across the two: the dial names who *renders* the rows, never
which rows there are. `table` is the only key that moves — and its name stays
RESERVED in both modes, so a chart's `report` cannot put a table back into a
panel answer. An unknown value is refused at definition rather than read as the
default: a mis-spelled dial that silently keeps working cannot be trusted to
have been set.

It says nothing about the WALK's surface. A host that draws the rows usually
wants to draw the walk too — that is `walk: { recording }` (`recording.ts`), and
the two dials are independent: either can be on without the other.

Reserved state keys the bridge reads: `verdicts`, `coverage`, `report`.
Reserved verdict word: `declined` (counted into the ledger as not-checked).
Reserved envelope names a `report` may not take: `af_coverage`,
`af_provenance`, `rule_version`, `walk`, `report_note`, and the projection
keys of a verdict-shaped run.

Phase boundaries (honest): pause is not yet bridged (a paused chart throws
with the checkpoint attached — `walk_segment` ships now so the wire will not
break when resumed segments arrive); inner dispatch refuses `checkIn` /
`wants` tools by name and resolves `needs` on the non-interactive path only.

## Why there is no runbook AUTHORING API — and what would reopen it

Everything here wraps a chart somebody else wrote. There is deliberately no
runbook GRAMMAR — no `defineRunbook({ subjects, rules, verdicts })` compiling
down to the fan-out, the decider and the reserved keys. One consumer has written
that chart by hand, and one estate is not a shape. What the hand-written version
really taught was six ENGINE behaviours rather than six missing API calls, and
those are published instead of hidden (`docs/build/runbooks-inside-a-fan-out`):
an authoring API would have concealed them, not fixed one of them.

"Wait" is the option nothing forces you to revisit, so the trigger is written
down here rather than left to be re-derived.

**The strong trigger — a second consumer that is NOT a triage.** No `verdict/*`
result kind, no rowset, no fan-out, and it raises an approval gate. That
consumer exercises the half of this module that has never run, and the repo is
visibly waiting for it: `WalkDescriptor.walk_segment` (`types.ts`) already ships
`'pre-pause'`/`'post-resume'` purely so the wire will not break when resumed
segments arrive, and `Tool.gates` (9.76.0, `core/tools.ts`) already lets a
procedure declare that it pauses — naming "the runbook grammar's compiler" as
the reader that would keep a gating tool out of a fan-out branch. Neither has a
reader in this repo today. A consumer needing both is the evidence that the
spine generalises past triage, and the moment to design the grammar.

**The weak trigger, and it is not the first one — a second consumer that IS
another triage.** Two triages do not prove a general shape. What a second one
would settle is narrower and still worth having: four choices on which there is
currently exactly one data point each.

1. Subject identity belongs in the stage NAME — because a decider inside a
   generated branch reports itself prefixed by name, never by id.
2. Run parameters must ride INSIDE the work item — because a branch is seeded
   with `{ item, index }` only, and `ExecutionEnv` is a closed type.
3. The two counts must be allowed to disagree — subjects fanned out over versus
   subjects that reached a verdict — with the gap named in `coverage` rather
   than filtered away.
4. Absence is thrown mid-fetch as the WHOLE answer, rather than folded into a
   partial rowset.

If a second estate independently makes the same four choices, that is real
evidence for a shape worth compiling. If it differs on any one of them, that key
is app-specific and must stay a callback, not grammar.
