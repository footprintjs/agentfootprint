---
type: fixed
---
**An empty assistant turn no longer fails the request with a 400.** An assistant message with no text and no tool calls was sent to the Anthropic Messages API as `content: ''`. The API accepts empty content only on a final assistant message, so a history carrying one mid-conversation failed the whole request with a 400 that no retry could mend. The turn is now left out of the body, the same way a system message is. This fixes `anthropic()`, `browserAnthropic()` and `invokeModelGateway()`, which now all build their messages through one shared mapping (`anthropic()` used to keep a private copy of it).
