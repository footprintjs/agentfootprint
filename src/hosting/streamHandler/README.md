Support

# Stream-handler internals

The `../streamHandler.ts` facade owns request-lifetime wiring and each stream’s existing closure state. This sealed folder owns unchanged contracts, request/body/refusal helpers and stored-conversation helpers. The shared `../failedSettlement.ts` owns the typed run-settlement projection for both direct and standing hosts. Provider outcomes are classified from actual terminal error classes; neither raw trace nor exception causes are passed to a wire adapter. No new timer or retry policy is introduced.
