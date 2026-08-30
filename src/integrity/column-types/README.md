# column-types — the tool declared what its rows contain, and the rows say otherwise

**One job.** A tool may declare its rowset's columns and their types
(`Tool.resultColumns`). Under the operator's `checkColumnTypes` dial, the library
checks the rows it actually returned against that declaration at the moment the
tool answers, and files what it finds.

## Why — three failures, one shape

All three are _a number became something else, and nothing noticed at the seam_.

1. A mapping report wrote `str(m.get("logical_unit_number") or "")`. **LUN 0 is
   falsy**, so LUN 0 was stored as an **empty string** on 2,094 mappings — and a
   host group missing the LUN an initiator probes first became indistinguishable
   from one that had it.
2. A capacity view rendered `round(mib / 1024, 1)`, so an 8 MiB disk came out as
   `0.0 GB` — which reads as **no disk**, a provisioning failure, during a live
   incident.
3. A whole family of tools returned their numbers as quoted strings (`"1240"`),
   which silently blanked every chart, because nothing downstream could tell a
   measure from a label.

The library already lets a tool declare what its result **is** (`resultKind`,
9.70.0). It did not let a tool declare what its result **contains**, so there was
nothing for a rowset to be wrong against.

## The ceiling — stated first, because it bounds everything else

> This judges TYPE, never MEANING — it can see that a column declared `number`
> holds a string, and it can never see that the string should have been 0, or
> that a 0.0 should have been an 8; a column whose every value has its declared
> type passes here and can still be wrong.

That sentence ships as `COLUMN_TYPE_CEILING` and is quoted **verbatim** into
every finding this check files, so the bound cannot drift out of the docs and
leave a reader believing the library knows more than it does. Failure 1 and
failure 3 above are caught. **Failure 2 is not** — `0.0` is a perfectly good
number — and the check says so out loud rather than letting a green row imply
otherwise.

## Two findings, because the field bug turned on the difference

| kind                   | means                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `column-type-mismatch` | the column is THERE and holds something other than its type |
| `missing-column`       | the declared column is in NONE of the rows                  |

"The value is not what it should be" and "the value is not there" send a person
to two different files. A checker that said only _"something is off with
logical_unit_number"_ would have helped with neither.

## The vocabulary

`number | string | boolean | date` — **not invented**: it is the column-type
union this ecosystem's rowset consumers already sniff their way to. The one word
deliberately left behind is `unknown`: a sniffer needs it ("I looked and could
not tell"), a declaration has no use for it.

A column maps to a bare type or to `{ type, nullable? }`. `nullable: true` says a
row may carry no value (`null`, `undefined`, or the key simply not set); without
it, nothing-where-a-value-was-declared is a violation like any other, and every
such finding names the one-word fix.

**Open, never closed.** A declaration is a promise about what it NAMES. An
unlisted column is allowed and never judged — the day a backend adds a column,
nothing here starts crying about a change that broke nothing.

## What is not judged

A result is read only when it is an **array of plain objects with at least one
row**. Prose, a `null`, a bespoke `{ rows: [...] }` wrapper, a claim ticket — and
the **zero-row** result, which has no columns to be wrong about and belongs to
`empty-lookup` next door — all file an explicit `not-applicable` **row** and no
finding. That row is the point: a check that silently skipped what it could not
read would be the decoration this family exists to make impossible.

## Runnable example

```ts
import { columnTypesOf, readRowset } from './check.js';

const { findings, disposition, refusal } = columnTypesOf(
  {
    toolName: 'host_group_mappings',
    toolCallId: 'call-2',
    columns: { logical_unit_number: 'number', host_group: 'string' },
    // the LUN report, as it shipped: LUN 0 became ''
    reading: readRowset([
      { logical_unit_number: '', host_group: 'vdi-a' },
      { logical_unit_number: 3, host_group: 'vdi-a' },
    ]),
    mode: 'warn',
  },
  0,
);
// findings[0].kind === 'column-type-mismatch'
// findings[0].predicate === 'logical_unit_number'
// disposition === 'checked-fail'; refusal === undefined (warn changes nothing)
```

## Arming

Two halves, the `empty-lookup` law: `AgentOptions.checkColumnTypes` off `'off'`
**and** at least one tool declaring `resultColumns`. Absent either, the run is
byte-identical — the only visible difference is the two registered rows in the
disposition report, filed `not-applicable`, because registered-but-unarmed is a
ROW and never silence.
