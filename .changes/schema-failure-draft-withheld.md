---
type: security
---

**A governed run no longer streams a schema-failing draft.** Under an output policy, a final answer that failed `.outputSchema(...)` still went out on the public event stream before output admission: `agent.output_schema_validation_failed` carried it as `rawOutput`, and the parser's message — which can quote it (`JSON.parse` does) — rode that event and `reliability.retried` / `reliability.fail_fast` as `errorMessage`. Under an output policy the event now carries `draftWithheld: true` and a fixed message with no `rawOutput`, and the reliability events drop `errorMessage` for a schema failure. A fail-fast exit keeps the draft out of `ReliabilityFailFastError` too: its `cause.message` and the run's record carry the fixed sentence, and `payload.errorMessage` is absent. Retry rules still read the full detail on `validationError`. Ungoverned runs are unchanged.
