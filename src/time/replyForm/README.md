# Fold — time reply field bindings

This library reads a stamped association between the unchanged range field and
its optional correction sibling. It checks both actual field declarations and
the saved reserved context. A suffix or a response marker alone grants nothing.
It interprets no text, runs no chart and creates no pause. Requests without the
new association retain their existing semantics, including old saved pauses.

`bindings.test.ts` exercises the association, malformed copies and legacy absence.
