---
type: breaking
bump: major
---

**Answers warn about doubts by default.** Agents that leave the answer layer
unconfigured now attach the answer's standing to `agentfootprint.agent.turn_end`
and emit `agentfootprint.answer.assessed`. A prose answer with standing `not-sure`
or `ask` carries a line explaining why. With `.answerValidation()` or
`.outputSchema()`, the standing travels as data and the answer keeps its
validated format.

The standing keeps recorded tool outcomes when a history window drops their
messages, so a turn that previously read as consistent or not assessed may now
say why it is not sure.

**Migration:** Add `.answerLayer(false)` to restore the previous chart, committed
rows, events and answer. To keep the standing data and omit the line, use
`.answerLayer({ standingLine: false })`. The same values work in
`AgentOptions.answerLayer`.

The first assessed turn loads the assessment code on demand, so that work
counts against the turn's deadline before final delivery.

When the line appears, it is part of the delivered assistant message. If the
conversation retains that message, the next request can carry the line within
its assistant history.

In a composition, a member Agent's standing line travels with its answer into
the next step's input and any mapper that reads the member's text, so use
`.outputSchema()` or `.answerLayer({ standingLine: false })` for a member whose
answer is parsed.

Ordinary streaming sends the model's text in `stream.token`. If output admission
holds the provider's chunks, the released token contains the composed answer.
Output middleware formats the model's text first. The standing line is appended
after that formatting, outside any closing marker the formatter added. Use
`.answerLayer({ standingLine: false })` if your app needs the formatter's exact
text and still wants the standing as data. The built-in text stream sends any
remaining text after the tokens, including when opened before a resume. If your
app paints its own tokens, use `turn_end.finalContent` for the finished message or render the
standing and reason codes from `agentfootprint.answer.assessed` in your own UI.
