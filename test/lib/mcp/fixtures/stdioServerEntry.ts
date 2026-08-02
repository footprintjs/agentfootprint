/**
 * A real MCP stdio server, as a real process.
 *
 * `realTransportSupport.bundleEntry` compiles this file to CommonJS and
 * the tests spawn it with `node`, so `mcpServe`'s stdio path runs the way
 * a desktop MCP host would run it: its own process, its own stdin/stdout,
 * nothing injected.
 *
 * stdout belongs to the protocol here — anything printed there corrupts
 * the stream — so failures go to stderr and take the process with them.
 */

import { mcpServe } from '../../../../src/tool-providers/index.js';
import { servedTools } from './servedTools.js';

async function main(): Promise<void> {
  await mcpServe(servedTools(), { name: 'support-desk', version: '1.2.3' });
}

main().catch((error: unknown) => {
  process.stderr.write(`stdioServerEntry failed: ${String(error)}\n`);
  process.exit(1);
});
