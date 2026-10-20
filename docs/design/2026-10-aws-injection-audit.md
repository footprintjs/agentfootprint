# AWS SDK injection audit

Checked against the source and the complete AWS command-pin registry on
2026-10-20. This is an inventory, not a claim that every adapter already has
the public convention. The goal is public `sdk` and `client`, exported module
types on the matching door, named validation before a lazy load, and no
underscore aliases. Each adapter keeps its own documented client protocol;
making names consistent must not silently replace a semantic client with a
raw vendor client.

The present PR fixes **only Bedrock Converse**. Its old `_sdk`, `_client` and
`_commands` are removed, with migration advice. The following rows identify
all remaining AWS injection seams for a separate follow-up issue.

| Adapter / source | Public options today | Remaining internal options |
| --- | --- | --- |
| Bedrock Converse, `src/adapters/llm/BedrockProvider.ts` | `sdk`, `client` in this PR | none |
| AgentCoreStore, `src/adapters/memory/agentcore.ts` | `sdk`, `client` | `_client` |
| AgentCore identity and complete-authorization helper, `src/adapters/identity/agentcore.ts` | neither | `_sdk`, `_client` on both options |
| AgentCore sessions, `src/adapters/hosting/agentcore.ts` | `client` | `_sdk`, `_client` |
| AgentCore browser, `src/adapters/browser/agentcore.ts` | neither | `_sdk`, `_client` |
| AgentCore code runner, `src/adapters/code/agentcore.ts` | neither | `_sdk`, `_client` |
| AgentCore MCP transport, `src/adapters/mcp/agentcoreRuntime/transport.ts` | `sdk`, `client` | `_sdk` deprecated alias |
| BedrockAgentMemory, `src/adapters/memory/bedrockAgentMemory.ts` | `client` | `_sdk`, `_client` |
| S3 Vectors, `src/adapters/memory/s3Vectors.ts` | `client` | `_sdk`, `_client` |
| S3 artifacts, `src/artifacts/s3Artifacts.ts` | `client` | `_sdk`, `_client` |
| CloudWatch and delegated AgentCore observability, `src/adapters/observability/cloudwatch.ts` | neither | `_sdk`, `_client` |
| X-Ray, `src/adapters/observability/xray.ts` | neither | `_sdk`, `_client` |
| Bedrock embeddings, `src/embedders/index.ts` | `client` | `_sdk`, `_client` |

The MCP invocation helper already uses public names; its outer transport owns
the remaining alias. AgentCore OpenTelemetry delegates to the existing OTEL
adapter and does not load an AWS SDK itself. Non-AWS adapters are outside this
audit and are not renamed by this change.

For the follow-up: migrate one small adapter group at a time; preserve each
interface's shared conformance assertions and AWS command-name pin; add public
type, static-module/no-loader, prebuilt-client ownership, missing-constructor
and no-alias tests. Any internal-option removal gets explicit release migration
notes. Do not move AWS details into provider-neutral ports or select a strategy
by vendor name. No live AWS call is needed for this work.
