---
type: added
---
**Compare a dataset's times as instants, never as spellings: `normaliseInstants`.** A dataset
that declares its `timeAxis` can now be read through one view: `normaliseInstants(rows, axis)`
turns the declared column — epoch seconds, epoch milliseconds, or ISO strings in any offset —
into UTC instants at one precision, sorted, each with the row it came from, so comparing two as
text compares them in time. It only reads the rows; the stored bytes never change. A string with
no offset under an axis with no `zone` could be any of 24 hours, so it is never read as UTC: the
view counts it (`status: 'naive-values'`), or places nothing under `{ naive: 'refuse' }`. Under a
declared `zone`, a wall time the autumn clock change doubles is placed by the rows' order and
noted; one the order cannot place (a lone `01:30`, rows out of order) is counted, and a wall time
the spring change skips is counted too. The axis now shares the library's one time grammar, which
changes two things at mint: an `interval` may have any number of digits (`1000000m` used to be
refused), and a `zone` must be an IANA name — an abbreviation such as `PST`, a bare offset such as
`+05:30`, or `utc` in lower case is refused by name (the platform used to accept them, reading
`PST` as Los Angeles time, which is -07:00 half the year). A ticket minted earlier with such a
zone now reads `malformed` from `readTimeAxis`, so a viewer shows it as an error instead of
guessing.
