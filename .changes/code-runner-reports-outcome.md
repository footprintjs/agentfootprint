---
type: fixed
---
**Code-runner failures and clipped output reach the answer warning.** AgentFootprint records a failed run as an incomplete call and a clipped successful run as partial work. The warning gives the retained output size and the original size when the runner established it. The model still reads the same tool output, and output that fits exactly at the limit is recorded without a cut.
