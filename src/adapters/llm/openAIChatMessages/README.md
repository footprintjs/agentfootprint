**Support** — translates already composed messages into the Chat Completions wire shape.

# OpenAI Chat Completions messages

`toOpenAIMessages` maps the provider-port messages onto the owned Chat
Completions wire shape. It preserves user and tool rows and translates the
system role for reasoning models. The adapter itself owns the final SDK
handoff, including any request-only record note.
