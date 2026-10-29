---
type: added
bump: minor
---
**A retried MCP call is in the saved run: every attempt, its wait, and how it ended.** When the agent dispatches a tool from `mcpClient`, that call's retry series now files one `agentfootprint.tools.request_attempts` event into the run. It lists each attempt with its outcome (`answered`, `refused`, `failed` or `timed-out`), why the series went on or stopped after it (`retryable`, `exhausted`, `wait-limit`, `no-time-left`, `not-replayable`, `not-retryable`), the wait before the next attempt and any `Retry-After` the server stated, and then how the request ended. It rides `recordRun` recordings, so a saved and re-read run gives it back.

A run cancelled during a wait still carries it. The run's cancellation now ends the call's retry series at once, and the series files `cancelled` with `during: 'wait'` (or `'request'`, for an attempt in flight) at that moment. Before, a cancelled run left the series waiting and asking again after the run had ended.

Receiving a response is not success: a 503 is `answered` with `status: 503`, and it is still never retried. Two calls, or two runs, sharing one MCP client never mix their attempts. A request with more than 100 attempts lists the first 100 and counts the rest in `omitted`.

The record is allow-listed metadata only: numbers, the library's own words, and your `endpointLabel` or else the endpoint's origin (scheme, host and port). It never holds the URL's path or query, the call's arguments, the server's answer or a thrown error's text; a failure is a fixed sentence and its category. Under a run's redaction policy, the label and the origin are served as the placeholder, like any name you declared. AgentCore Runtime's session-busy retries file the same way. A call made outside an agent run (a direct `execute`, `mcpServe`), a client built on your own `connection`, and a transport with retry off (no series runs) file nothing.
