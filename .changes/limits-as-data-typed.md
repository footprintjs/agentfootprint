---
type: fixed
---
**`.limitsTravelWithTheAnswer()` no longer breaks a typed answer — with `.outputSchema()`, the limits come back as data.**
The option adds the limits your tools declared (what they checked, what they did not check,
what they can never cover) to the final answer as a block of text. When the agent also had an
output schema, that text was added after the model's JSON, and JSON followed by text is not
JSON: `agent.runTyped()` threw `OutputSchemaError` on every answer whose tools declared a
limit, and an `.outputFallback()` replaced a perfectly good answer.

Now a typed answer stays exactly what the model sent, so `runTyped()` parses it. The same
limits come back beside it, as data: `agent.answerCoverage()` returns
`{ checked, notChecked, cannotCover }` (a repeated limit said once, every entry kept), the
`turn_end` event carries it as `answerCoverage`, and the run's snapshot holds it as
`answerCoverage`. Nothing is added when no tool declared a limit. An answer without an output
schema is unchanged: it still gets the block, byte for byte.
