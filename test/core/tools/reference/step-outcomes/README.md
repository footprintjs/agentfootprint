# Procedure step outcomes

The retained captures in `v14-native-components` record the old wording. Only
`agent-answer-layer` and `agent-stepped-skill` use these new captures. Each has
one step whose tool declares no status and one unfinished-step nudge. The
manifest binds both complete captures for each case.

The comparison replaces those two sentences in recorded history, tool results,
message projections and the requests a provider saw. It recomputes the
affected message summaries, content hashes and message and total request
lengths. Every other byte is compared with the retained capture.

Recapture the two selected cases with
`AF_TOOLS_REFERENCE=update AF_TOOLS_REFERENCE_CASES=agent-answer-layer,agent-stepped-skill`
and the same two case names in the byte-identity test filter.
