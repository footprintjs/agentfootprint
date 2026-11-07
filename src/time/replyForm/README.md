# Fold — time reply field bindings

This library reads a stamped association between the unchanged range field and
its optional correction sibling. It checks both actual field declarations and
the saved reserved context. A suffix or a response marker alone grants nothing.
It interprets no text, runs no chart and creates no pause. Requests without the
new association retain their existing semantics, including old saved pauses.

`timeReplyPairs` is public on `agentfootprint/time`, because a host's front end
needs the same answer and reads the request off a wire. So every read is of own
data, whatever the JSON holds. It throws on a stamped binding that does not match
its fields, because `[]` means the ask declares no pair and the server's own read
of the same binding would still say otherwise.

`bindings.test.ts` exercises the association, malformed copies, legacy absence and
JSON off a wire; `test/time/reply-pairs-door.test.ts` does the same through the door
on a real ask.
