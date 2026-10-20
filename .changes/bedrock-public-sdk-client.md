---
type: added
---
**Public Bedrock SDK and client injection for bundled hosts.** `bedrock()` and
`BedrockProvider` accept `sdk` and `client`; the structural `BedrockClient` and
`BedrockConverseSdkModule` types are exported from `agentfootprint/providers`.
An injected module bypasses the default SDK loader. A prebuilt client retains
its configuration and lifecycle; named command constructors still come from
the supplied module or the installed optional peer.

**Breaking internal-option rename.** `_sdk`, `_client` and `_commands` have been
removed without aliases and are refused by name before SDK loading.

Migration: rename `_sdk` to `sdk` and `_client` to `client`. Replace
`_commands: { Converse, ConverseStream }` with
`sdk: { ConverseCommand: Converse, ConverseStreamCommand: ConverseStream }`.
There is no separate command-map option. Existing callers that let the adapter
load the SDK are unchanged. Other AWS adapters' internal injection options are
tracked separately; this change does not rename them.
