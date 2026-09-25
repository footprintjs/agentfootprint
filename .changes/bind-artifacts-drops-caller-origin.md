---
type: fixed
---
**A binding drops a caller-supplied `origin` on every path.** `origin` is not on the capability's input type, but a JavaScript caller could pass one, and it survived whenever the binding had no origin of its own to stamp. This is a behaviour change of the PUBLIC `bindArtifacts`: a binding created WITHOUT an `origin` option now drops an input's own `origin` — including the one `recordingPutInput(…, { runId })` or a chart-walk helper puts there — instead of passing it through. Pass `bindArtifacts(store, scope, { origin })` to stamp one. No change for tools, whose binding always had one.
