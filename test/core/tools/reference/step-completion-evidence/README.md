# Procedure step completion evidence

Only `agent-answer-layer` and `agent-stepped-skill` use these captures. The
manifest binds each to the complete prior capture in `step-outcomes`.
Each records one step that advanced after an undeclared tool result. The
comparison adds the counts for that advance at the ToolCalls commit and
checks every other byte against the prior capture.

To recapture, run the byte-identity test with
`AF_TOOLS_REFERENCE=update AF_TOOLS_REFERENCE_CASES=agent-answer-layer,agent-stepped-skill`
and a filter for the same two cases.
