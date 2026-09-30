# core/time/readers — the library's time readers

A reader turns a person's words into time PARTS and a verbatim quote, behind the
`TimeReader` port (`../reader.ts`). It never resolves an instant, applies a date
order or maps a zone — that is `resolve.ts`'s, the policy's or the ask's. The
folder imports only the port (pinned by `test/core/time/english-reader.test.ts`).

| File | Reader |
|------|--------|
| `english.ts` | `englishTimeReader()` — a `kind: 'rule'` tokenizer over the v1 phrases of the time design's § 5.3; ONE `unreadable` mention for every other time phrase it recognises |

## The allow-list — the only forms filed as the person's words

Five review rounds each found the next spelling a deny-list missed: a zone named
in words (`yesterday London time`, `server time`, `in Asia/Kolkata`), a look-back
anchored to an event (`the last 2 hours of the outage`), an open end
(`yesterday post-deploy`). English has an endless tail, so the English reader no
longer tries to list what it must distrust. It TRUSTS a short allow-list and
grows it only from evidence (`english.ts` · `isAllowListed`):

1. **A relative span from now** — `last|past N minutes|hours|days|weeks`,
   `the last|past hour|day|week`. A look-back needs no zone and no date order:
   the library supplies nothing.
2. **An explicit ISO-8601 instant or range** whose every bound carries an offset
   or an IANA zone — `2026-10-09T08:00-07:00`, `2026-10-09T08:00Z/2026-10-09T09:00Z`,
   `2026-10-09T08:00 America/Los_Angeles`.

Everything else it reads — calendar words (`today`, `yesterday`), a date or a
clock time with no zone (`2026-09-26`, `8 AM to 9 AM`), a zone abbreviation — is
marked `confirm` on the port (`TimeMention.confirm`), recorded as
`confirmNeeded: { form: true }`, and offered through the time ask pre-filled
with the reading AND its zone:

> *I read “yesterday” as Thu, Oct 8, 2026, PDT in America/Los_Angeles — is that right?*

A person who meant London time corrects it in one answer. An allow-listed
reading is the person's words only when the leftover scan below also finds
nothing, it is alone, and it is no bare point time (`../rows.ts` ·
`confirmNeededOf`). `previous 7 days` (often relative to another window),
`last 30 seconds` and `last week` (a calendar week) are not read at all.

```ts
reader.read('errors in the last 2 hours', ctx);     // said: a look-back from now
reader.read('errors 2026-10-09T08:00-07:00', ctx);  // said: an explicit instant
reader.read('errors yesterday', ctx);               // confirm: yesterday, in the run's zone
reader.read('errors yesterday London time', ctx);   // confirm: form + leftover ['time']
reader.read('the last 2 hours of the outage', ctx); // confirm: leftover ['of'] — anchored to an event
```

**The trade-off.** More confirmations: every calendar word now pauses once for a
one-answer confirmation where it used to be filed as said. That is the honest
direction: a day read in the wrong zone is 8 to 17 hours off, and the record would
call it the person's words. **How the list grows:** a form joins it only when a
benchmark shows the reader reads it right (the paid bench, time design § 13
T6b); it is never widened by argument.

## The leftover rule — the person's words only when nothing time-like is left

A partial reading is the one wrong answer a reader must never give: reading
`8:40 AM` out of `8:40 AM til 9.30` and filing it as *said* records a narrower
window than the person meant. Three review rounds showed a deterministic English
grammar cannot PROVE it read a whole range: lists of connectors leaked `til`,
`→`, `~`; a clause rule then leaked a clause mark before a capital
(`8:40 AM, Till 9.30`, `Start: 8:40 AM\nEnd: 9.30`), ranges to an event
(`8 AM until the deploy`) and word-list gaps (`today until april`). So the
contract changed: the reader no longer tries to be exact about what it did NOT
read — it only has to notice that something is left.

> After removing every phrase it parsed, if the WHOLE message still holds a
> time-or-range token, every reading of it is INCOMPLETE: it names the tokens
> (`TimeMention.leftover`) and is CONFIRMED through the time ask — never filed as
> the person's words. With nothing left, a reading is COMPLETE — and theirs
> when its form is on the allow-list above.

- **The set** (`english.ts` · `LEFTOVER_WORDS`, `LEFTOVER`, `LEFTOVER_CASED`,
  `JOINER`) — broad and conservative, case-insensitive: any digit in any script;
  number and hour words (`one` … `sixty`, `noon`, `midnight`, `half`,
  `quarter`), ordinals (`first` … `thirtieth`); day and relative words (`today`,
  `tonight`, `tonite`, `last`, `next`, `ago`, `since`, `before`, `after`, `then`,
  `now`, `about`, `around` …); week day and month names, whole and short; units
  (`hr`, `min`, `sec`, `hours` …); parts of the day (`morning`, `EOD`, `lunch`,
  `close` …); range words (`to`, `until`, `till`, `til`, `through`, `thru`,
  `between`, `from`); zone words (`pacific`, `utc`, `time`, the IANA areas
  `europe`, `asia` …); anchors, open ends, exclusions and filters (`preceding`,
  `prior`, `post`, `onward`, `henceforth`, `excluding`, `except`, `weekdays`,
  `business`); `of` right after a look-back; `..`; and ANY symbol or
  punctuation mark except sentence punctuation (`. , ; : ! ?`), quotes and brackets —
  by rule, not by list, so `>`, `<`, `≥`, `=`, `|`, `»`, `_` and every arrow block
  count (`english.ts` · `COUNTED_MARK`) — unless it stands alone between two letters
  (`check-in`, `and/or`, `request_id`);
  `and`, `plus`, `minus` right after a time. In capitals only: `AM` and the zone
  abbreviations — lower-case `am` is English, and a meridiem is only ever said
  with a number, which the scan counts already.
- **What is removed**: a READ phrase whole — its connector and its range opener
  (`from`, `between`) included; an unreadable phrase only in its words, so the
  modifier or mark that made it unreadable (`~ 9:30 PM`, `since 8 AM`) still
  counts beside every other reading.
- **Where it lands**: the `time-reading` row records `confirmNeeded: { leftover }`
  and the choice stays `open` with `confirm` (its candidates carry `said: []`);
  the window is never a turn window until the person answers the time ask —
  *"I read only “8:40 AM” as a time, not “til 9.30”. Is this the window you
  mean?"*, the reading offered as the one choice, free entry open. The answer is
  filed `answered`.

```ts
reader.read('errors yesterday?', ctx);              // COMPLETE: yesterday (off the list → confirm)
reader.read('from 8 AM to 9 AM yesterday', ctx);    // COMPLETE: 8 AM to 9 AM yesterday (confirm)
reader.read('2026-09-26 08:00..08:40 UTC', ctx);    // COMPLETE: the whole range — said
reader.read('8:40 AM til 9.30', ctx);               // 8:40 AM, leftover ['til', '9.30'] → confirm
reader.read('8 AM until the deploy', ctx);          // 8 AM, leftover ['until'] → confirm
reader.read('9 AM and 3 retries', ctx);             // 9 AM, leftover ['and', '3'] → confirm (the price)
```

## A point is not a window; one reading, not several

The scan is a word list, and five review rounds showed a word list always leaks
the next spelling (`8 AM forward`, `post 8 AM`, `>8 AM`, `start 8:40 AM, end 9:30
PM`, `8 AM into 9 PM`). So the LIBRARY closes the class by the reading's SHAPE,
for every `rule` reader (`../rows.ts` · `confirmNeededOf`, the one owner):

- **A point time is not a window.** A reading that names one clock time or
  instant with no second bound (`8 AM`, `8:40`, `yesterday 8:40 PM`,
  `2026-10-09T08:00`) is never filed as the person's window, whatever stood
  beside it: the row records `confirmNeeded: { point: true }` and the ask offers
  it with its zone. Only a WINDOW-COMPLETE reading may be said: a range whose
  two bounds were read in one span, a relative span (`last 2 hours`), a whole
  calendar unit — and, as the one exempt point, an EXPLICIT instant
  (`2026-10-09T08:00-07:00`, `rows.ts` · `isExplicitInstant`: the person wrote it
  whole; its window is the instant at the grain written). The allow-list above
  then narrows what the English reader vouches.
- **More than one reading confirms**, unless the two were read as one range: the
  rows record `confirmNeeded: { several: true }` (`today vs yesterday`, `start
  8:40 AM, end 9:30 PM`).

```ts
reader.read('errors 8 AM forward', ctx); // 8 AM — no leftover, but a POINT → confirmed
reader.read('8 AM into 9 PM', ctx);      // two points, two mentions → both confirmed
reader.read('last 2 hours', ctx);        // window-complete, alone → the person's words
```

**The known limit.** Calendar words always confirm now, so `errors yesterday
henceforth` no longer reads as said. What only the scan still guards is a
look-back from now beside an anchor word it does not list: `logs last 2 hours
surrounding the outage` reads as the look-back, filed as said. Pinned as the limit
by `english-reader.test.ts`; the paid bench measures how often a person writes it.

**The trade-off (owner-approved).** More confirmations: any message that holds a
time-or-range word the reading did not cover confirms — `9 AM and 3 retries`,
`the 5 slowest calls yesterday`, `I want to see yesterday` (`to`), `logs from
yesterday` (`from`), `errors in the last 2 hours to date`, `May I see yesterday's
errors`. An extra confirmation is honest; a partial reading recorded as said is
not. Since a point time and every form off the allow-list always confirm, what
the scan still cannot see is a look-back beside a word outside the set (above) —
a word to add to the one list, never a connector or a clause rule.
