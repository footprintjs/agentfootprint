**Support** — close an owned client.

Close is final and idempotent, starts synchronously, and never terminates a caller-owned client.

The plain function knows no chart or scope. Its stage adapter reads the call
capability, calls the function, and publishes bounded facts. No sibling stage
is imported; the chart owns their ordering. Tests live beside this owner.
