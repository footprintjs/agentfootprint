---
type: fixed
---
**Overlapping runs of one composition stamp each event with their own run.** `Sequence`,
`Parallel`, `Conditional`, `Loop`, `Graph`, `Workflow`, `LLMCall` and `LlmRouter` read the run
context their events are stamped with from the instance, so when two runs of ONE instance
overlapped, every event dispatched after the second run started carried the second run's id — a
recording or self-explain view grouped by run read the first run's tail as the second's, and its
facts were served under the second run's redaction. Each run now stamps its events with the run
that produced them, and a pause request is served under the run that paused. An `Agent` refuses
overlapping runs (`RunInFlightError`) and is unchanged.
