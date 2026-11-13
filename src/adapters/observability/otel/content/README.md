**Support** — tool content capture behind its existing opt-in.

`tools.ts` snapshots the proposal when `tool_start` arrives. On completion it
deletes the snapshot, withholds changed keys and code-runner arguments, and
uses the model-read result when present. Failed or unexecuted calls export no
content. The shared projections keep complete-or-omitted size semantics.

The rule: a later mutation cannot enlarge what the model's view disclosed.
The adjacent tests mutate arguments after capture and mark a runner later.
