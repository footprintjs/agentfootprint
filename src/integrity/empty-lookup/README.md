# empty-lookup — the run produced the id, and the lookup found nothing

**Why.** A triage agent's reverse-lookup tool filtered a column before a pivot, so the column did
not exist yet and EVERY reverse lookup returned an empty result — for every identifier, always. The
tool then answered SUCCESSFULLY with an empty list, and the agent reported in a table, with
confidence, that the device was "not currently logged in to any port on the collected switches",
advising a check of the physical cabling. It was logged in the whole time. Every rail passed
honestly: nothing errored, nothing was ungrounded, no coverage was overstated. **An empty result
from a broken filter is byte-identical to an empty result from a genuine absence**, and nothing in
the framework was responsible for noticing the difference.

**What the library already knew.** Two facts it was holding separately:

1. the identifier was **grounded** — it came out of an earlier tool result in this run, from a tool
   the consumer's own author named in `Tool.argumentsFrom`;
2. the lookup keyed on it came back **empty**.

Joining them is the whole check. When the run itself produced the identifier and the lookup for it
finds nothing, that is worth filing.

**The ceiling, and why this can never be an accusation.** An empty answer can be perfectly true —
the device may exist and simply have no logins right now. **Nothing here can tell those apart**, and
nothing here pretends to. So the check files an ADVISORY (`advisory: true`, counted apart from
defects everywhere the family reports), the finding says "worth a look" and never "this is wrong",
and the identical advisory is filed for the broken filter and for the honest absence. The ceiling
sentence has ONE owner — `EMPTY_LOOKUP_CEILING`, exported and quoted verbatim into every message:

> An empty result can be perfectly true — the thing may exist and simply have nothing to show right
> now — so this is a place to look, never a verdict that anything is wrong.

**Not `dangling-reference`, and the names must not blur.** `dangling-reference` means _the ground is
no longer in reach_ — the evidence was evicted and the tool is still offered. This is the opposite:
the ground **is** in reach, the run really did serve it, and the lookup came back with nothing.

**Where it checks.** The **write seam** — the tool-dispatch boundary, at the one moment a lookup's
answer becomes a fact in the conversation. Not the choice seam: the argument was fine, and it is the
ANSWER that is about to be written into context and read as a truth about the world. Judged on the
tool's own return value, before the after-tool chain rewrites it for the model — whether the lookup
found anything is a fact about the tool, not about what a governance rule then did with it.

**What counts as EMPTY — and what this refuses to judge.** A result is read only when it can be
COUNTED, never interpreted:

| Result | Verdict |
| --- | --- |
| an array with zero elements | **empty** — a rowset with zero rows |
| an array with any elements | not empty → `checked-pass` |
| an `absent(...)` envelope | **empty** — the author said the search ran and matched nothing |
| a sentence, a `null`, a bespoke `{ rows: [] }` wrapper, an object, a placement claim ticket | **`not-applicable`** — the library cannot see rows in it, so it does not judge it |

That last row is the point. A check that silently skipped what it could not read would be the
decoration the disposition ledger exists to make impossible: the encounter files an explicit
`not-applicable`, so "nothing was wrong" and "I could not look" stay different observable states.

**The fences**, shared with the choice seam and read from the same file (`../argumentLeaves.ts`) so
the two can never drift apart about which value they are talking about:

- non-strings are never checked — not identifier-shaped;
- values under four characters are never checked — substring matching is noise below that;
- grounding is case-insensitive substring against the DECLARED producers' results only. The choice
  seam asks the broader question (did anything the run served carry this value); this asks the
  narrow one, because `argumentsFrom` says where the value was supposed to come from.

**The dispositions**, all four in play, which is unusual and deliberate:

| State | Disposition |
| --- | --- |
| the lookup returned rows | `checked-pass` |
| the value was grounded and the lookup was empty | `checked-fail` (one advisory per argument path) |
| the value was not in any declared producer's result | `checked-pass` — a real comparison, no join |
| no declared producer served anything in this run | `unreachable` — nothing to compare against |
| the result shape could not be read; or the call errored, was denied or refused | `not-applicable` |

**Armed by two halves.** `AgentOptions.noticeEmptyLookups: true` **and** at least one tool declaring
`argumentsFrom`. The declaration alone is deliberately not enough: it already arms
`dangling-reference` and `unsupported-argument`, and an advisory that armed itself off a declaration
made for something else would not be opt-in at all. Absent, a run is byte-identical — no finding,
no event, nothing on the wire changes. The one visible difference is the registered `empty-lookup`
row filed `not-applicable`, which is the family's law rather than an exception to it.

**Runnable example.**

```ts
import { emptyLookupOf, readLookupResult } from './check.js';

const { findings, disposition } = emptyLookupOf(
  {
    toolName: 'port_for_device',
    toolCallId: 'call-2',
    args: { wwpn: '20:00:00:25:b5:aa:00:1f' },
    argumentsFrom: ['fabric_inventory'],
    reading: readLookupResult([], false), // the tool returned an empty list
  },
  [{ toolName: 'fabric_inventory', text: 'devices: 20:00:00:25:b5:aa:00:1f (host-a)' }],
  2,
);
// disposition === 'checked-fail'
// → one advisory 'empty-lookup' at seam 'write', naming both tools, the value
//   and the call id, with the ceiling sentence in its own message. Nothing was
//   blocked, retried or rewritten.
```
