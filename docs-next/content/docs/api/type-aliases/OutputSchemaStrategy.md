---
title: OutputSchemaStrategy
---

# Type Alias: OutputSchemaStrategy

> **OutputSchemaStrategy** = `"instruct"` \| `"tool-forced"` \| `"native"`

Defined in: [src/answer-validation/outputSchema.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/outputSchema.ts#L104)

How the schema reaches the model.

  • `'instruct'` (default) — the shape is described in the system prompt
    and the model is asked for JSON. Works on every provider, because it
    is only words.
  • `'tool-forced'` — the shape is presented as a synthetic tool and the
    provider's tool choice is FORCED to it, so generation is constrained
    at the source instead of requested in prose. Requires a provider that
    declares `carriesForcedToolChoice` and permits the selected model
    through its optional `supportsForcedToolChoice`; a provider that does not is
    refused BY NAME at run start rather than quietly downgraded, because
    a strategy that silently falls back to the other one is config that
    lies.
  • `'native'` — the provider's own structured output: the schema rides the
    request as Anthropic's `output_config.format` (`{ type: 'json_schema',
    schema }`) and the model's text answer is decoded under it. Unlike
    `'tool-forced'` it keeps the agent's tools: the model may still call a
    tool first, and answers in JSON when it answers. Requires a provider
    that declares `carriesNativeOutputSchema` and permits the selected model
    through its optional `supportsNativeOutputSchema`; the same refusal BY
    NAME applies at run start. The schema sent is a wire copy made
    API-compatible by `nativeOutputFormat.ts · nativeOutputFormat` (every
    object closed with `additionalProperties: false`, the constraints the
    API does not take moved into the description); a schema the API cannot
    express is refused at build. The parser still judges every answer
    against the full contract, and a `stop_reason` of `'refusal'`,
    `'max_tokens'` or `'model_context_window_exceeded'` fails the attempt by
    name even when the text parses (a refusal is not re-asked).
