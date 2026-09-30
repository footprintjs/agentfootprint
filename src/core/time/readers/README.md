# core/time/readers — the library's time readers

A reader turns a person's words into time PARTS and a verbatim quote, behind the
`TimeReader` port (`../reader.ts`). It never resolves an instant, applies a date
order or maps a zone — that is `resolve.ts`'s, the policy's or the ask's. The
folder imports only the port (pinned by `test/core/time/english-reader.test.ts`).

| File | Reader |
|------|--------|
| `english.ts` | `englishTimeReader()` — a `kind: 'rule'` tokenizer over the v1 phrases of the time design's § 5.3; ONE `unreadable` mention for every other time phrase it recognises |

## The clause rule — read whole or not at all

A partial reading is the one wrong answer a reader must never give: reading
`8:40 AM` out of `8:40 AM til 9.30` records a narrower window as *said*. Three
rounds of lists of connectors (`to`, `till`, `-`, …) and openers (`about`, `the`)
each leaked the next spelling — `til`, `→`, `~`, `up to`, `to approx. 9.30`,
`to EOD`, `between yesterday and 1600`. A deny-list cannot win, so the English
reader is an ALLOW rule instead (`english.ts` · `settleClauses`):

> A v1 phrase is read only when the rest of its **clause** says nothing else
> time-like. Otherwise the whole clause is ONE unreadable mention quoting it.

- **Time-like** (`TIME_LIKE`, `TIME_LIKE_CASED`): a digit in any script; an hour
  or number word (`one` … `twelve`, `noon`, `midnight`, `half`, `quarter`); a day,
  week day or month word; a meridiem; a unit (`hours`, `days`); a time-of-day
  word (`now`, `EOD`, `lunch`, `sunset`); `o'clock`. Capitalised only: `AM`,
  `May`, `March`, `Sun` … (`am` and `may` are English).
- **Clause** (`CLAUSE_MARK`): it ends at `.` `!` `?` `;` `,` or a newline only
  when the text ends there or the next token is a CAPITALISED word that is not
  time-like (`… for checkout. Thanks`). A lower-case word continues the clause —
  so `8:40 AM, to 9.30` and `yesterday, between 8 and 9` are one clause each.
- **Whole**: a clause whose time-like tokens all sit inside ONE phrase the
  grammar reads (`10/09/26 8 AM to 8:40 AM PST`, `between 8 and 9 AM`) is read.
  The grammar's range connectors (`RANGE_CONNECTOR`: `to until till through thru`
  and the three dashes) are an allow-list of what is READ — never of what is not.

```ts
reader.read('errors yesterday?', ctx);        // read: yesterday
reader.read('8:40 AM til 9.30', ctx);         // one unreadable mention: "8:40 AM til 9.30"
reader.read('8:40 AM → EOD', ctx);            // one unreadable mention: "8:40 AM → EOD"
reader.read('9 AM and 3 retries', ctx);       // one unreadable mention: the price below
```

**The trade-off (owner-approved).** A clause that mixes a time with an unrelated
number or time word is asked, not read: `9 AM and 3 retries`, `8 AM and 9 AM`,
`the 5 slowest calls yesterday`, `which one failed yesterday`, `May I see
yesterday's errors`. An extra ask is honest; a partial reading recorded as said
is not. Known gaps the rule cannot see (no digit, no listed word): Roman numerals
(`to IX`) and time words outside the list (`till closing`) — each reads the v1
side alone, and each is a word to add to the list, never a connector.
