Support

# Stream-handler internals

The `../streamHandler.ts` facade owns request-lifetime wiring and each stream’s existing closure state. This sealed folder owns unchanged contracts, request/body/refusal helpers, stored-conversation helpers and the typed run-settlement projection. Provider outcomes are classified from actual terminal error classes; neither raw trace nor exception causes are passed to a wire adapter. No new timer or retry policy is introduced.
