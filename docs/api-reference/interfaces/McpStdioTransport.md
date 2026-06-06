[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / McpStdioTransport

# Interface: McpStdioTransport

Defined in: [src/lib/mcp/types.ts:33](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/types.ts#L33)

`stdio` transport — spawns a local subprocess and speaks MCP over
its stdin/stdout. Best for development, single-user scenarios, and
testing against locally-installed MCP servers.

## Properties

### args?

> `readonly` `optional` **args?**: readonly `string`[]

Defined in: [src/lib/mcp/types.ts:38](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/types.ts#L38)

CLI args passed to the executable.

***

### command

> `readonly` **command**: `string`

Defined in: [src/lib/mcp/types.ts:36](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/types.ts#L36)

Executable to spawn (e.g., `'npx'`, `'node'`, `'python'`).

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [src/lib/mcp/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/types.ts#L42)

Working directory for the subprocess.

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/lib/mcp/types.ts:40](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/types.ts#L40)

Optional env vars set on the subprocess.

***

### transport

> `readonly` **transport**: `"stdio"`

Defined in: [src/lib/mcp/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/types.ts#L34)
