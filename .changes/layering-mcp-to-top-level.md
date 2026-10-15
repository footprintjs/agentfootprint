---
type: internal
---
**The MCP transport left `src/lib/` for a top-level folder.** `src/lib/mcp/` (`mcpClient`, `mcpServe`, the tool-extras wire format, elicitation) moved to `src/mcp/`, with its tests from `test/lib/mcp/` to `test/mcp/`. The folder keeps its layer in the layer table, so `npm run check:layering` reports the same edges. Internal paths only: every public door exports the same names.
