---
type: fixed
---
**The evidence gate reads a typed answer value by value, so compact JSON no longer turns correct numbers into invented ones.** A typed answer written the way `JSON.stringify` writes it was tokenised as text. `{"total":1200}` kept the key's colon on the value, and `:1200` was looked up as an identifier no tool result carried. `[5,100]` read as the thousands-separated `5100`, and `[0.45,0.12]` as one identifier. Correct answers were flagged: `'guard'` spent its one revision on them and `'rails'` refused them. `[1200,9750]` read as no value at all, so an invented number in an array was never looked up.

An answer that is one JSON object or array — what `.outputSchema()` accepts — is now read value by value: every key and string decoded, every number the literal the answer **wrote**, read left to right in one pass after `JSON.parse` has checked the grammar. A number is never read through the double it parses to, so `9007199254740993` is not taken for `9007199254740992`, a 20-digit serial is not rounded, and under `decimalRounding` a written `5.20` keeps the precision the rounding rule judges.

The shared spelling rule also takes a key's leading colon off a plain number in text (`export ok: {"total":1200}`), on both the answer's side and the results' side (`::ffff:10.0.0.1` keeps its colons). Two consequences are worth knowing:
- A three-digit number in compact JSON is no longer a candidate. Before, it was flagged only by the `:123` accident, so this is now the same `minDigits` rule prose gets.
- The inputs layer's `sameArgumentValue` now treats `':8080'` and `'8080'` as one value.
