**Fold** — `owner.ts` parses and settles the existing typed-output contract.

The original parser, fallback and validation precedence remain unchanged.
Events use the admitted invocation when there is one; an arbitrary parsed
string does not invent a run or retry count. `owner.test.ts` covers native
typed answers and parse-failure settlement through the public runner.
