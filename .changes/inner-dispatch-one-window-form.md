---
type: fixed
---
**A composed tool can call a windowed tool through `ctx.tools` with ONE window.** Inner dispatch
refused a ruled tool unless EVERY ruled argument was given — and for a tool that declares a
`period` with two forms (a look-back `window` beside `start`/`stop` bounds), every period argument
is ruled. So a composer that passed a look-back was refused for leaving the bounds out, one that
passed the bounds was refused for leaving the look-back out, and passing all three is two windows,
which such a tool refuses itself: every call a runbook could make failed before the tool ran. A
period's forms are alternatives now, at inner dispatch exactly as for the model's own calls: a call
that gives one form whole (every argument but the zone) owes nothing for the forms it did not take.
Half a window — one bound alone — still owes the rest, and every non-period ruled argument is still
owed one by one.
