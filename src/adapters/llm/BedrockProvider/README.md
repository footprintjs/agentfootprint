Support

# Bedrock Converse adapter internals

Only the adjacent `BedrockProvider.ts` facade and files in this folder import these modules. The facade owns provider construction and dispatch; `types.ts` declares SDK shapes, `client.ts` resolves SDK command names and wraps transport errors, `request.ts` translates history/cache placement, `response.ts` projects ordinary results and validates tool arguments, and `stream.ts` owns unconfigured streaming with live deltas and terminal intrinsic-intervention admission.

The initial split moves whole units from `BedrockProvider.ts`: client/send/error units; request/history/tool units; response/tool-integrity/stop-name units; and the unguarded event-loop body. No cache policy or model capability decision moves to the guardrail classifier.

`guardrailConfig.ts` validates and captures the optional declaration before SDK client construction, and maps it once for either operation. `guardrailSchemas.ts` owns the supported action carrier families and public type enums. `guardrailRead.ts` bounds admitted own-data reflection; `guardrailClassify.ts` gives a valid block precedence over masks and incomplete siblings. Only fully examined masking-only evidence admits masked output. Unknown or malformed evidence never invents a block. Private matches, custom labels, regex bodies and model output are not read just to discard them.

The documented [Converse trace](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseTrace.html) and [ConverseStream trace](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStreamTrace.html) have independent optional `guardrail` and `promptRouter` root members. The classifier recognizes the router field by name without reading its descriptor or contents. A router-only ordinary response remains usable; an explicit intervention without assessment remains unknown. Unknown root siblings, guardrail families and actions still cannot certify masking-only output.

`guardrailResponse.ts` formats only safe terminal metadata and projects complete results before touching unusable tools or text. The optional synchronous formatter is application code: its effects and execution duration are caller-owned. A mutation attempt, throw or invalid return keeps the distinct terminal outcome and raises its typed error, retaining the original throw only in the cause channel.

`guardedStreamBuffer.ts` holds returned text/tool fragments under the configured UTF-8 byte ceiling. `guardedStream.ts` waits for messageStop, later metadata and natural stream completion before ordinary tool parsing or release. Transport errors and caller aborts release no held content and retain their existing category. A never-ending iterator remains under its existing abort/transport signal; no timer or second request is added. Raw trace is processed privately at metadata arrival and is never part of a returned response or error.

Usage-only metadata may precede messageStop. An early trace instead makes the response framing incomplete: later usage-only or masking metadata cannot erase it and authorize release. The terminal disposition is unknown, and held text/tool fragments remain withheld without inspecting the early assessment's contents.

Documented ConverseStream exception members remain transport failures, including an exception arriving after assessment metadata. Their public message and category are fixed; the original payload remains only in the private cause channel. Once a configured stream request was sent, a failure receives the shared error-local replay veto after ordinary error translation. This does not create an intervention outcome, alter an existing error's identity or authorize an automatic resend.

The 4,096-read classification budget counts admitted structure/action reads separately from the 32-descriptor output cap. Native key enumeration can allocate a foreign key set before the size check, the SDK allocated its response first, and a Proxy trap can execute arbitrary synchronous code. These bounds therefore do not promise a total memory, CPU or callback execution-time limit.

An unconfigured intrinsic intervention is still unknown at the terminal boundary. Complete and streaming responses withhold their terminal text/tools and native final memory. Streaming retains already served prefixes, which cannot be recalled; completed tool fragments stay private until the stop disposition is classified, before argument parsing. Ordinary unconfigured output remains unchanged.
