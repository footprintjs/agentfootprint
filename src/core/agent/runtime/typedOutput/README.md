**Mixed** — parse and settle the existing typed-output contract.
`owner.ts` is the **Fold** that parses accepted data and the **Trace** that
files the existing fallback facts through the admitted invocation.

Parser, fallback and validation precedence remain unchanged. An arbitrary
parsed string does not invent a run or retry count. `owner.test.ts` covers
native typed answers and parse-failure settlement through the public runner.
