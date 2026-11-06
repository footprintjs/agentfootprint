# Walker — time reply

This sealed library interprets the existing range answer plus one optional correction sibling. Only `../reply.ts` and this folder import its implementation. It returns a typed decision; it never pauses, runs an executor, calls a model, changes a clock, writes a record or dispatches a tool. The existing resumed ask owns request admission, privacy, recording the decision/rule and the native pause lifecycle.

| Unit          | One job                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | narrow input/output and fixed, bounded rule/reason vocabulary                                                   |
| `decode.ts`   | exactly one populated channel and bounded primitive text                                                        |
| `classify.ts` | strict interval, existing English whole-zone correction, or one fully consumed existing English time mention    |
| `resolve.ts`  | replace zone tokens or resolve checked replacement words under the saved clock, always proposing a confirmation |
| `project.ts`  | retain the existing ISO enum's confirmed/edited meaning; a full interval in correction text is an edit          |
| `decision.ts` | compose those units behind the facade                                                                           |

There is no new time grammar. The English facade owns its bounded affirmative whole-zone correction grammar; unsupported wrappers, negation, multiple zones and leftover words do not produce a correction. Time words must occupy the complete correction string, so an extracted “yesterday” cannot discard a negation. Unreadable text remains pending with examples, without a rejection-phrase allowlist or an ISO error.

The caller supplies the current bound reading, frozen clock, policy and preferably the exact pending range/zone pairs. The module does not authenticate a request or admit a checkpoint. The old range field keeps its ID, strict format, ISO enum and labels; only `required` changes when the optional text sibling exists. Exactly one channel is accepted. No action field or opaque IDs are introduced. An edited interval asserts no IANA zone; the parent retains its existing conversion/zone admission policy. Zone/time-word corrections always return `reask`, never permission to execute. The existing meaning confirmation remains; there is no mounted chart or pause topology change.

An elapsed span's known endpoints do not need an extra zone question. If the caller's map/display contract cannot interpret the said label, the resolver keeps UTC and records that label as `zone-unconverted`; presentation must quote it and say it was not converted, never claim a verified zone or borrow the clock's fallback. Civil windows still ask where the zone can change an endpoint. This distinction is resolver policy, not another reply grammar.

`reask.row` is ephemeral existing-shaped time-reading data. A time-word replacement uses the actual checked correction quote; it never pretends the old quote contained new words. A zone-only correction retains the original time words and explicitly replaces their zone tokens. The parent keeps this proposal under the existing protected ask working state, not as a new raw ledger row, and records bounded decision/rule metadata. There is no new durable `rawCorrection` mirror, raw text in a reason or parser exception projection. Native cancellation stays with its existing owner; the reply module has no cancellation protocol.

Adjacent tests exercise the pure rules and their bounded evidence. They do not prove native pause, host or checkpoint compatibility. Native resume, published-pause compatibility, field-byte equality and private served surfaces have separate integration tests.

After the library ships, host correction-box rendering is a separate follow-up; a host that ignores the optional sibling retains its existing range UI. This folder does not adopt app dependencies or assert that those follow-ups have run.
