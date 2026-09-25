---
type: fixed
---
- **`.findings()` notes no longer reach the user through the token stream, or
  from prose and code blocks.** 9.114.1 took the model's `_findings` off the
  answer `run()` returns, but two paths still showed it. The streamed tokens
  (`agentfootprint.stream.token`) were the model's raw output, sent before the
  key was taken off, so a chat UI rendering the stream showed the notes; and
  only an answer that was entirely one JSON object was cleaned, so notes
  written in a code block or in the prose — for example a JSON block at the
  end of a prose answer — stayed in the answer. Both now go through one
  step, shared by the stream and the answer: every JSON object in the answer
  loses its own `_findings` member — the whole answer, one in a code block,
  one in the prose, one in a list — and nothing else changes. A code block or
  a paragraph that held only the notes goes whole, fences included; an object
  emptied anywhere else stays `{}`, so a list or a line of code keeps its
  shape. The notes found anywhere are filed as standings, as before. Under
  `.findings()` each streamed token is what can be shown so far — a piece
  that ends part way through the key is held back until the key is read —
  and the answer turn's tokens join to exactly the answer `run()` returns
  (unless an output rule, such as `.messageMiddleware()`, rewrites it
  afterwards); a token is skipped when a piece shows nothing yet, so
  `tokenIndex` can skip numbers;
  `stream.llm_end` carries the same text. CallLLM's commit, and history for
  a turn that calls tools, keep what the model sent; the Route decider then
  commits the peeled answer as `llmLatestContent`, the answer the run
  records. Two visible changes: an answer the model wrote
  as JSON keeps its own spelling (9.114.1 parsed it and wrote it back out:
  compact JSON as `JSON.stringify` writes it is byte for byte what 9.114.1
  returned; indentation, number format, `\u` escapes, key order and repeated
  keys are now kept as the model wrote them), and a JSON list answer whose
  items carry `_findings` now loses it too, the list staying JSON (9.114.1
  returned lists untouched). Text that stops being JSON part way — a stray
  quote or a raw line break inside the notes — is returned as the model
  wrote it, less any complete notes before the break. Notes written one
  closing brace short still go, and the text after them is kept; notes a
  cut-off stream leaves unfinished stay hidden, with `{}` left where they
  began when they shared a line and their object held nothing else. An answer
  that held nothing but notes is now empty (a bare JSON object of notes stays
  `{}`). An agent without `.findings()` streams and answers exactly as
  before.
