[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / McpStdioTransport

# Interface: McpStdioTransport

Defined in: [agentfootprint/src/lib/mcp/types.ts:33](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L33)

`stdio` transport — spawns a local subprocess and speaks MCP over
its stdin/stdout. Best for development, single-user scenarios, and
testing against locally-installed MCP servers.

## Properties

### args?

> `readonly` `optional` **args?**: readonly `string`[]

Defined in: [agentfootprint/src/lib/mcp/types.ts:38](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L38)

CLI args passed to the executable.

***

### command

> `readonly` **command**: `string`

Defined in: [agentfootprint/src/lib/mcp/types.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L36)

Executable to spawn (e.g., `'npx'`, `'node'`, `'python'`).

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [agentfootprint/src/lib/mcp/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L42)

Working directory for the subprocess.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [agentfootprint/src/lib/mcp/types.ts:40](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L40)

Optional env vars set on the subprocess.

***

### transport

> `readonly` **transport**: `"stdio"`

Defined in: [agentfootprint/src/lib/mcp/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L34)
