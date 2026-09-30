# core/time/readers — the library's time readers

A reader turns a person's words into time PARTS and a verbatim quote, behind the
`TimeReader` port (`../reader.ts`). It never resolves an instant, applies a date
order or maps a zone — that is `resolve.ts`'s, the policy's or the ask's. The
folder imports only the port (pinned by `test/core/time/english-reader.test.ts`).

| File | Reader |
|------|--------|
| `english.ts` | `englishTimeReader()` — a `kind: 'rule'` tokenizer over the v1 phrases of the time design's § 5.3; ONE `unreadable` mention for every other time phrase it recognises |

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
> the person's words. With nothing left, a reading is COMPLETE and is theirs.

- **The set** (`english.ts` · `LEFTOVER_WORDS`, `LEFTOVER`, `LEFTOVER_CASED`,
  `JOINER`) — broad and conservative, case-insensitive: any digit in any script;
  number and hour words (`one` … `sixty`, `noon`, `midnight`, `half`,
  `quarter`), ordinals (`first` … `thirtieth`); day and relative words (`today`,
  `tonight`, `tonite`, `last`, `next`, `ago`, `since`, `before`, `after`, `then`,
  `now`, `about`, `around` …); week day and month names, whole and short; units
  (`hr`, `min`, `sec`, `hours` …); parts of the day (`morning`, `EOD`, `lunch`,
  `close` …); range words (`to`, `until`, `till`, `til`, `through`, `thru`,
  `between`, `from`); zone words (`pacific`, `utc` …); `..`; and ANY symbol or
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
reader.read('errors yesterday?', ctx);              // COMPLETE: yesterday
reader.read('from 8 AM to 9 AM yesterday', ctx);    // COMPLETE: 8 AM to 9 AM yesterday
reader.read('2026-09-26 08:00..08:40', ctx);        // COMPLETE: the whole range
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
  it — *"I read 08:00–09:00 — is that the window you mean?"*. Only a
  WINDOW-COMPLETE reading may be said: a range whose two bounds were read in one
  span, a relative span (`last 2 hours`), or a whole calendar unit (`yesterday`,
  `2026-09-26`).
- **More than one reading confirms**, unless the two were read as one range: the
  rows record `confirmNeeded: { several: true }` (`today vs yesterday`, `start
  8:40 AM, end 9:30 PM`).

```ts
reader.read('errors 8 AM forward', ctx); // 8 AM — no leftover, but a POINT → confirmed
reader.read('8 AM into 9 PM', ctx);      // two points, two mentions → both confirmed
reader.read('last 2 hours', ctx);        // window-complete, alone → the person's words
```

**The known limit.** What only the scan still guards is a window-complete reading
beside an open-range word it does not list: `errors yesterday henceforth` reads as
the day, filed as said. Pinned as the limit by `english-reader.test.ts`; the paid
bench measures how often a person writes it.

**The trade-off (owner-approved).** More confirmations: any message that holds a
time-or-range word the reading did not cover confirms — `9 AM and 3 retries`,
`the 5 slowest calls yesterday`, `I want to see yesterday` (`to`), `logs from
yesterday` (`from`), `errors in the last 2 hours to date`, `May I see yesterday's
errors`. An extra confirmation is honest; a partial reading recorded as said is
not. Since a point time always confirms, what the scan still cannot see is a
window-complete reading beside a word outside the set (`yesterday henceforth`,
above) — a word to add to the one list, never a connector or a clause rule.
