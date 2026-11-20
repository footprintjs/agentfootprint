**Lens** — admitted evidence for model-facing trace tools.

`traceToolpack` checks for after-tool result decisions before creating an index. Ordinary recordings keep their existing view. A restricted recording exposes two state keys across the fold base, final state and replay log.

| Key          | Source and reason                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `history`    | `projectTraceHistory` keeps conversation messages with their model-written proposals and only positively admitted tool text. |
| `turnNumber` | `seedConversationTurn` supplies this conversation ordinal independently of tool content.                                     |

The projected event list keeps iteration starts and excludes tool results, their timings, derived events and host payloads. Stage labels and commit anchors remain. The toolpack omits unclassified state paths, free-form evidence and child contents. The entry and settlement lists are deliberately outside this view. Child bindings check their evidence before describing retained contents.

Direct construction may explicitly select the host's record. A self-explaining or dedicated debug agent always uses the admitted view.
