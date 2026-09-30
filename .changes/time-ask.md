---
type: added
---
**A time answer is checked before your app sees it: `format` on a `requestInput` field.** An app
that asks the person for a window used to re-check every answer itself — backwards, no offset,
`PST` for a zone — and a re-ask often repeated the question with no word about why. Declare the
field's `format`: `'instant'` (an ISO 8601 date-time with its offset), `'time-range'` (an ISO 8601
interval `from/to` of two, `from` before `to`) or `'zone'` (an IANA name such as
`America/Los_Angeles`); it is refused unless `type: 'string'`, and a choice or supplied value that
is not its format is refused at definition. At `agent.resume` an answer the check refuses is not
taken: the same ask comes back with `refused: { answer, reason }` and `repeat: { count }`, the
field missing again, and nothing runs — no model call. Under `.time()`, which knows the person's
zone, a wall time the clocks skip (`2026-03-08T02:30-08:00` in Los Angeles) is refused too. The
reason is a sentence from `defaultTimeAskMessages` (exported from the main entry and
`agentfootprint/observe`); `.time({ messages: { 'answer.no-offset': '…' } })` rewords any key,
and an unknown key is refused. This refines 9.127.0's "the library never writes a reason": it
writes one only for a check the app armed by declaring the field. `labels` name each `enum`
choice; a time field's choices keep free entry open unless `strict: true`. Over MCP,
`elicitationOf(awaitingInput)` builds the elicitation request (a range as two `date-time`
properties, choices as `enum` + `enumNames`) and `answerFromElicitation` turns the client's content
back into the resume's answer. With a reader armed, a reading's labels now render in the reader's
`locale` (`Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT`), and a reader whose `locale` is not a language
tag is refused at the builder. Without a `format` field nothing changes.
