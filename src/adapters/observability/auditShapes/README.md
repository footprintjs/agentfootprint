**Lens** — bounded audit views for every event payload, preserving declared structure while marking content.

The sibling `auditShapes.ts` is the only entry. It retains the six original exports,
public comments and signatures, composes event groups in their original order,
and constructs a fresh plain object or Map for each caller. This folder is sealed;
other adapters import the facade.

`vocabulary.ts` supplies exhaustive payload typing. `pieces/` owns reusable rules;
`events/` owns whole event shapes. Dependencies flow from vocabulary and bounding
primitives through pieces to events and then the facade, never back to a consumer.
There is no I/O, cached event table or snapshot of the live tool-run callback.

`surface.test.ts` pins own keys, descriptors, shared rule identity and Proxy reads.
`surface.fixture.json` was captured from main at
`78c11f2908515c4be1cb9a86a566f87487e736f1`, before extraction. It is a compatibility
fixture, not a new audit-fates baseline. The existing exhaustive depth/fates and
bounded sweep tests remain unchanged.
