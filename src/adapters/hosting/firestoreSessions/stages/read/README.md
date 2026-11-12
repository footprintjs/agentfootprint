**Support** — read one stored row.

A missing row is absence; a failed read is never absence. Keep the existing SDK failure boundary.

The plain function knows no chart or scope. Its stage adapter reads the call
capability, calls the function, and publishes bounded facts. No sibling stage
is imported; the chart owns their ordering. Tests live beside this owner.
