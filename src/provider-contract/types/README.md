Support

The provider-port declarations behind the stable `../types.ts` facade.
Only the facade and this sealed folder import these files directly.

- `message.ts` owns conversation messages and their recording-only fields.
- `request.ts` owns one provider request, importing the facade's shared tool schema.
- `response.ts` owns responses, wire manifests and stream chunks.
- `provider.ts` owns the provider contract and per-call resilience reports/hooks.
- `code.ts` owns code/browser sessions, their result shapes and feature detection.

Permission declarations, `checkerGoverns`, tool schema and pricing remain in the
facade. These are whole-declaration moves; provider behavior belongs to adapters,
and response admission belongs to the runner. The new optional intervention field
is part of the response port, with its evidence and typed errors owned separately
by `../intervention.ts`.
