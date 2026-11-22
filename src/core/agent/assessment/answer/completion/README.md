**Fold** — decides which completion reasons the committed record supports.

The fold reads the accepted provider response’s stop reason and the Route
decider’s turn-limit marker. Only the provider contract’s `max_tokens` stop
supports the output-limit warning. A later provider response replaces that
fact. A local fallback carries no provider stop. A tool or argument pause
has no delivered answer yet. The tool-loop limit keeps its own reason and witness.

The adjacent tests use mock providers and round-trip real engine recordings
in both encodings.
