---
type: changed
---
**Numeric ranges are checked endpoint by endpoint when no intact value was read.**
An exact whole-token result wins first: a carried ZIP+4 `12345-6789`, part
number `1020-3040`, or rack `10-20` stays one grounded identifier. Otherwise,
exactly-two-number hyphen or en-dash ranges check their endpoints independently,
after app-declared ID shapes. Dates, clock ranges, dotted versions and multipart
IDs stay intact. Short bare endpoints below `minDigits` remain unchecked prose.
This default classification change is independent of opt-in decimal rounding.
