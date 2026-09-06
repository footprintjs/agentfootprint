**Support** — the outer ring: one port per external dependency and one adapter
file per vendor. It carries a Lens someone else composed and writes into a Trace
someone else owns; it never decides what the model may see.

## What it reads / what it writes
- Reads: an already-composed request (system prompt, messages, tool list), or a
  vendor's response.
- Writes: nothing on scope. Adapters emit typed events through the channels the
  recorders own; they hold no run state.

## The one law here
A port is OUR shape and an adapter is THEIR shape — one file per vendor, and no
vendor name leaks past the port. An adapter that starts deciding what a model
is shown has become a Lens and belongs beside its composer.

## Files
- `types.ts` — the ports of the hexagonal architecture, in one place.
- `llm/`, `memory/`, `identity/`, `hosting/`, `mcp/`, `observability/`,
  `security/`, `browser/`, `code/`, `google/` — one folder per port.
