---
type: fixed
---
**The evidence gate no longer reads a number in a compact JSON answer as an invented identifier.** A typed answer written the way `JSON.stringify` writes it — `{"total":1200}` — kept the key's colon on the value once the quotes became separators, so `:1200` was looked up as an identifier no tool result carried. Every number of three or more digits in such an answer was flagged: `'guard'` spent its one revision on a correct answer and `'rails'` refused it. The colon now comes off before a plain number, on both the answer's side and the results' side (`::ffff:10.0.0.1` keeps its colons), so a typed answer that copies a tool's number is grounded and an invented one is still flagged under its own spelling.
