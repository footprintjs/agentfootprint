---
type: added
---
**Show a question's time window in a viewer's zone as well as its interpretation zone.**
An agent with `.time()` accepts `timeDisplay: { viewerZone }` on a new question.
Confirmation labels, model-facing time lines and the final coverage block name
the viewer display without changing instants, confirmation values or tool
arguments. The display declaration is recorded with its purpose and restored
from the same turn's record. Missing interpretation zones still require an
answer; malformed display input is refused before effects. Omitted display
input preserves the existing behavior.
