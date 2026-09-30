**Support** — the library's time readers: a reader proposes time parts from a person's words; it decides nothing.

# core/time/readers — the library's time readers

A reader turns a person's words into time PARTS and a verbatim quote, behind the
`TimeReader` port (`../reader.ts`). It never resolves an instant, applies a date
order or maps a zone — that is `resolve.ts`'s, the policy's or the ask's. The
folder imports only the port (pinned by `test/core/time/english-reader.test.ts`).

| File | Reader |
|------|--------|
| `english.ts` | `englishTimeReader()` — a `kind: 'rule'` tokenizer over the v1 phrases of the time design's § 5.3; ONE `unreadable` mention for every other time phrase it recognises |

## It only PROPOSES — the person confirms (the owner's decision "Always confirm")

**Nothing a reader reads in chat is ever filed as the person's words.** Every
reading of a chat message is a PROPOSAL: the time ask offers it pre-filled and
editable, naming the window AND its zone, and only what the person picks or
types in that form is theirs.

> *Is this the time you meant by “yesterday”?* — *I read “yesterday” as Thu,
> Oct 8, 2026, PDT in America/Los_Angeles — is that right?* (one click), or free
> entry to write another window.

**Why.** Seven review rounds each found the next English spelling that a word
list, then an allow-list, then a position rule misread and filed as said: a
half-read range (`8:40 AM til 9.30`), an open end (`8 AM forward`), a zone named
in words (`yesterday London time`), a look-back tied to an event (`the last 2
hours of the outage`, `last 2 hours ending at the outage`), an instant with an
open end (`newer than 2026-10-09T08:00Z`). English has an endless tail; a wrong
window recorded as the person's words is the failure that matters. So the owner
decided (2026-09-30, time design TQ29): the reader proposes, the person confirms.

**Where the law lives.** In the LIBRARY, for every reader of either kind
(`../rows.ts` · `timeReadingRows`): each `time-reading` row's candidates carry
`said: []` and its choice stays `open` with `confirm` (the policy may still
narrow the readings — `dateOrder: 'MDY'` leaves one to confirm). This reader
returns parts and a verbatim quote only — no confirm flag, no leftover list, no
allow-list (the port refuses a mention carrying either as `malformed`).

**What the answer files** (`../rows.ts` · `TimeAnswerRow`): one `time-answer`
row per mention the person settled — the window, its zone, and `how`:
`confirmed` (they picked the offered reading — their click) or `edited` (they
wrote their own). Both are the person's answer: the argument rows are
`answered`, the rest of the turn's calls are filled from it (`../bind.ts` ·
`turnWindowsOf`, source `answered`), and the served sentence names it with its
source ("the window the person confirmed when asked what their words meant").
An unreadable phrase proposes nothing: the tool's own rule asks, with no pre-fill.

```ts
reader.read('errors in the last 2 hours', ctx); // { quote: 'last 2 hours', parses: [...] } — a proposal
reader.read('8:40 AM til 9.30', ctx);           // { quote: '8:40 AM', parses: [...] } — a proposal; the person corrects it
reader.read('yesterday morning', ctx);          // unreadable — the tool's own rule asks, no pre-fill
```

**The trade-off.** Every time phrase costs one click before the first call that
needs it — "last 2 hours" included. A tool whose rule ASSUMES its period is
asked too: its default never stands in for words the person wrote
(`../../agent/arguments/resolve.ts` · `verifyPlan`). In return no chat reading
is ever recorded as the person's words.

**How it grows.** A form may later skip the click only when a registered,
committed benchmark shows the reader ALWAYS reads it right (TQ29's growth rule)
— never by argument, and never by a word list.
