/**
 * Shared plumbing for the real-transport MCP tests.
 *
 * The injection-based tests (`mcpClient.test.ts`, `mcpServe.test.ts`) are
 * the fast path: they pin behaviour with a mock SDK in microseconds. The
 * `*.real.test.ts` files are the truth path: they run the SAME code
 * against @modelcontextprotocol/sdk over a real pipe and a real socket,
 * because a transport that is only ever mocked is a transport nobody has
 * run. Both are kept.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { build } from 'esbuild';

export const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Spawning a child process needs a runnable file, and the source is
 * TypeScript, so the fixture is bundled with esbuild (already a
 * devDependency) at test time. Building per run — rather than committing
 * a snapshot — is what keeps the child honest about the current source.
 *
 * Two details that are load-bearing:
 *   - `packages: 'external'` leaves `footprintjs` and the MCP SDK as bare
 *     `require`s, so the child resolves the same installed copies the
 *     tests use — and so `lazyRequire` exercises the real lazy peer-dep
 *     path rather than a bundled-in copy.
 *   - the output therefore has to sit somewhere those bare requires
 *     resolve from, which is why it lands under the repo's node_modules
 *     (also conveniently git-ignored) instead of the OS temp directory.
 *
 * @param entryRelative repo-relative path of the TypeScript entry
 * @param outName file name for the bundle; give each test file its own so
 *   parallel runs never write the same file
 * @returns absolute path of the runnable script
 */
export async function bundleEntry(entryRelative: string, outName: string): Promise<string> {
  const outfile = resolve(REPO_ROOT, 'node_modules/.agentfootprint-mcp-test', outName);
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(REPO_ROOT, entryRelative)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    packages: 'external',
    logLevel: 'silent',
  });
  return outfile;
}

/**
 * Ask the OS for a port nobody is using, then give it back.
 *
 * Since 7.19.1 `mcpServe`'s handle reports the port it bound, so a test that
 * only needs *a* port should serve on 0 and read `handle.port` — no probe, no
 * race. This stays for the tests that need the number BEFORE serving: proving
 * `close()` frees a port means binding the same one twice on purpose.
 */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/**
 * Wait until `pid` is gone. Process exit is asynchronous, so "the child
 * was killed" can only be asserted by looking, not by assuming.
 *
 * @returns true if the process disappeared before the deadline
 */
export async function waitForExit(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // Signal 0 does not signal; it only asks "is this pid still there?".
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Real transports cost real milliseconds — a child process to spawn, a
 * socket to bind, an HTTP round trip. Scoped to these tests only; the
 * injection-based suite keeps the default timeout.
 */
export const REAL_TRANSPORT_TIMEOUT = 30_000;
