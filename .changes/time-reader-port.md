---
type: added
---
**Read the person's words for time through your own reader — and have every reading recorded:
`.time({ reader, policy })`.** "10/09/26 8 AM to 8:40 AM" is 9 October to an American and
10 September to most of the world; a parser that silently picks one answers a question nobody
asked. Arm a `TimeReader` (`{ id, version, locale, kind: 'rule' | 'model', read }`): it returns
the zone-less PARTS it sees and the verbatim quote — `10/09/26` is three numbers, the order
undecided — and the library resolves them against the run's clock into every candidate window:
the three date orders, am and pm for a bare `8:40`, both instants of a wall time the clocks go
back through, a day word such as "yesterday", a look-back such as "last 40 minutes", a range read
to the end of its grain ("to 8:40" runs to 08:41). A zone abbreviation such as `PST` is left to
the person, never mapped. The policy picks among the candidates — `dateOrder: 'ask'` (default) or
`'MDY'` / `'DMY'` / `'YMD'`, `year: 'ask'` (default) or `'current'` — and a pick is recorded as
assumed. On the record (`agent.findings()`): one `time-reading` row per mention with the quote,
the parts, every candidate and how the reading settled (`only`, `policy`, `open` with the
questions only the person can answer, or `none`), plus the reader's id, version, kind and locale
and the tz database version. The reader runs once per message, and only on a message a person
wrote: a message this library wrote in a person's voice and a composed run's message are never
read, and a resume or a `resumeOnError` retry reads the recorded row instead of calling the
reader again (a message with no time files one row saying so). A `kind: 'model'` reader's window
is never taken as the person's words — it waits for the person to confirm it. A quote the reader
invents is refused and nothing of it is kept; a reader that returns something other than
`{ mentions: [] }` fails the run, naming it. Nothing is served to the model yet. Without a reader
nothing changes; a `policy` without a reader is refused. A checkpoint that carries the new row is
refused by an older runtime.
