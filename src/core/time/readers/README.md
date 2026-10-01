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
(`../rowsBuild.ts` · `timeReadingRows`): each `time-reading` row's candidates carry
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
An unreadable phrase proposes nothing — and is still ASKED: "Which time did you mean by
“yesterday morning”?", free entry, nothing pre-filled, whatever the tool's own rule says (the
person wrote a time, so a default never stands in for it — time follow-ups, packet "gaps"). The
answer is filed `edited` and converted into the tool's form like any other. Because an
unreadable phrase is asked, a phrase that names no time must read NO mention: a greeting
(`Good morning, any errors?`) is not a part of the day.

**A zone the person named is part of the reading** — after a clock time, a date
or a day word, as written: `yesterday London time` → `{ relative: day −1,
zoneToken: 'London time' }`. Which zone the words name is `../resolve.ts`'s (the
tz database's one zone for the place, an abbreviation only through the app's
map, else asked); reading `yesterday` alone would propose the app's zone for a
day the person put in London. A form the text itself fixes is marked: an ISO
time is a 24-hour clock (`clock: '24h'`), so `T08:00` is never also 8 PM.

```ts
reader.read('yesterday London time', ctx);      // { quote: 'yesterday London time', parses: [{ …, zoneToken: 'London time' }] }
reader.read('8 to 9:30', ctx);                  // unreadable — `8` is no time here, and 9:30 alone would drop the start
reader.read('errors in the last 2 hours', ctx); // { quote: 'last 2 hours', parses: [...] } — a proposal
reader.read('8:40 AM til 9.30', ctx);           // { quote: '8:40 AM', parses: [...] } — a proposal; the person corrects it
reader.read('yesterday morning', ctx);          // unreadable — asked which time, nothing pre-filled
reader.read('Good morning, any errors?', ctx);  // no mention — a greeting names no time, so nothing is asked
reader.read('today between 1 pm and 2 pm', ctx); // ONE mention — a day word may come before `between`
reader.read('between 14:15 and 14:40 on 11 September', ctx); // a named month: date fixed, the year the policy's
reader.read('in the last 24h', ctx);            // { quote: 'last 24h', … } — a compact look-back
```

**The trade-off.** Every time phrase costs one click before the first call that
needs it — "last 2 hours" included. A tool whose rule ASSUMES its period is
asked too: its default never stands in for words the person wrote
(`../../agent/arguments/resolve.ts` · `verifyPlan`). In return no chat reading
is ever recorded as the person's words.

**How it grows.** A form may later skip the click only when a registered,
committed benchmark shows the reader ALWAYS reads it right (TQ29's growth rule)
— never by argument, and never by a word list.
