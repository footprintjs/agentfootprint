**Walker** — verified request dispatch and turn admission.

# Request dispatch

`handler.ts` verifies once, selects the session or artifact read door, and admits
turns before choosing and synchronously serializing a lane. It also owns the
single ingress record funnel and anonymous request counter. Factories receive
callable ports from the facade rather than importing sibling implementations.
Tests pin admission refusal before any lane or turn is selected.
