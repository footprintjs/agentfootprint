**Mixed** — a contract for checking the exact answer before delivery.
Map: `types.ts` declares the authored checks, bounds and report vocabulary.
Walker: `evidence.ts` resolves bounded parcels under the run's existing scope.
Fold: `validate.ts` derives a verdict from explicit checks and evidence availability.

The host supplies the comparisons. This folder supplies no domain rules,
query engine, model judge, artifact store, or repair loop. It reuses the
existing artifact port and schema parser. `core/agent/stages/answerValidation.ts`
owns when validation runs; the final stage owns delivery and memory capture.

The validator receives a detached, frozen JSON value. Its canonical serialized
form is the value considered for delivery, including when a schema transforms
the input. A callback cannot return replacement content. Reports identify that
candidate by digest and record dispositions separately from artifact reads.

Each evidence resolver is scoped to one invocation, checks metadata before a
verifying store read, and closes on completion or cancellation. Missing and
foreign refs remain indistinguishable. Application stores and callbacks are
trusted ports; time and size limits are not a CPU or process-memory sandbox.

Without configuration the agent mounts none of this boundary. With it, both
modes suppress draft tokens. Enforce refuses failed or unverified reports;
observe permits delivery with the report available for inspection. Diagnostics
can still contain the original model candidate; this does not replace redaction.
