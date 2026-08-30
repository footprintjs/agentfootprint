/**
 * "install @modelcontextprotocol/sdk" must only be said when that is true.
 *
 * Every SDK load in this module sat behind a bare `catch`, and a bare catch
 * cannot tell "the package is absent" from "the LOADER is absent". The second
 * is what a browser bundle hits — `lazyRequire` reaches for `createRequire`,
 * which a bundler has replaced with a stub — and it was being reported as the
 * first. The reader installs a package they already have, nothing changes, and
 * they conclude MCP does not work in a browser.
 *
 * Two obligations, and they pull against each other, which is why both are
 * pinned here:
 *
 *   1. the absent-package message is BYTE-IDENTICAL to every release before
 *      this one (nothing about the ordinary Node failure may move); and
 *   2. any other failure says what actually happened and names the seam that
 *      gets past it.
 *
 * No test asserted either string before this file existed.
 */

import { describe, expect, it, vi } from 'vitest';

import { sdkLoadFailure } from '../../../src/lib/mcp/sdkLoadFailure.js';
import { defineTool } from '../../../src/index.js';

/** A server with no tools is refused before any SDK load, so serve one. */
const SERVED = [
  defineTool({
    name: 'ping',
    description: 'Answers.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'pong',
  }),
];

/** The exact text every release before this one produced. */
const HISTORICAL_CLIENT_MESSAGE =
  'mcpClient requires @modelcontextprotocol/sdk.\n' +
  '  Install:  npm install @modelcontextprotocol/sdk\n' +
  '  Or pass `_client` for test injection.';

const NOTES = {
  notInstalled: HISTORICAL_CLIENT_MESSAGE,
  caller: 'mcpClient',
  specifier: '@modelcontextprotocol/sdk/client/index.js',
  instead: 'Pass `sdk` (the two SDK modules, imported statically) or `connection`.',
} as const;

// ─── The classifier ───────────────────────────────────────────────

describe('sdkLoadFailure', () => {
  it.each([
    ["Cannot find module '@modelcontextprotocol/sdk/client/index.js'", 'node CJS'],
    ['MODULE_NOT_FOUND', 'node CJS code'],
    ['ERR_MODULE_NOT_FOUND', 'node ESM'],
    ['Failed to resolve module specifier', 'a bundler'],
    ['Dynamic require of "x" is not supported', "esbuild's shim"],
  ])('LAW: %s (%s) keeps the historical message byte for byte', (message) => {
    expect(sdkLoadFailure(new Error(message), NOTES)).toBe(HISTORICAL_CLIENT_MESSAGE);
  });

  it('LAW: a loader failure says so, and names the seam instead of an install', () => {
    const browser = sdkLoadFailure(
      new TypeError('nodeModule.createRequire is not a function'),
      NOTES,
    );

    expect(browser).not.toBe(HISTORICAL_CLIENT_MESSAGE);
    expect(browser).not.toContain('npm install');
    expect(browser).toContain('could not load @modelcontextprotocol/sdk/client/index.js');
    expect(browser).toContain('nodeModule.createRequire is not a function');
    expect(browser).toContain('the Node `require` loader does not exist there');
    expect(browser).toContain('Pass `sdk`');
    expect(browser).toContain('`connection`');
  });

  it('never throws from an error path, whatever it was handed', () => {
    expect(sdkLoadFailure('a bare string', NOTES)).toContain('a bare string');
    expect(sdkLoadFailure(undefined, NOTES)).toContain('undefined');
    const hostile = {
      toString() {
        throw new Error('nice try');
      },
    };
    expect(() => sdkLoadFailure(hostile, NOTES)).not.toThrow();
  });
});

// ─── Through the real load path ───────────────────────────────────

describe('mcpClient — which message a real failed load produces', () => {
  const failingLoader = (thrown: unknown) => ({
    lazyRequire: (): never => {
      throw thrown;
    },
  });

  it('an absent package is still reported exactly as it always was', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () =>
      failingLoader(new Error("Cannot find module '@modelcontextprotocol/sdk/client/index.js'")),
    );
    try {
      const fresh = await import('../../../src/lib/mcp/mcpClient.js');
      await expect(
        fresh.mcpClient({ transport: { transport: 'http', url: 'https://example.invalid/mcp' } }),
      ).rejects.toThrow(HISTORICAL_CLIENT_MESSAGE);
    } finally {
      vi.doUnmock('../../../src/lib/mcp/mcpClient.js');
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it("a browser's missing loader is NOT reported as a missing package", async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () =>
      failingLoader(new TypeError('nodeModule.createRequire is not a function')),
    );
    try {
      const fresh = await import('../../../src/lib/mcp/mcpClient.js');
      const failure = await fresh
        .mcpClient({ transport: { transport: 'http', url: 'https://example.invalid/mcp' } })
        .then(
          () => new Error('should have refused'),
          (e: Error) => e,
        );

      expect(failure.message).not.toContain('npm install');
      expect(failure.message).toContain('createRequire');
      expect(failure.message).toContain('Pass `sdk`');
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('the stdio arm says the honest thing: a subprocess is not portable', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () =>
      failingLoader(new TypeError('nodeModule.createRequire is not a function')),
    );
    try {
      const fresh = await import('../../../src/lib/mcp/mcpClient.js');
      // The client module loads first, so a *stdio* browser failure surfaces on
      // that specifier — and the sentence it carries is still the truthful one:
      // there is a seam, and stdio is not reachable through it.
      const failure = await fresh
        .mcpClient({ transport: { transport: 'stdio', command: 'never-spawned' } })
        .then(
          () => new Error('should have refused'),
          (e: Error) => e,
        );
      expect(failure.message).not.toContain('npm install');
      expect(failure.message).toContain('could not load');
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});

// ─── mcpServe answers the same way ────────────────────────────────

describe('mcpServe — the same class of lie, closed the same way', () => {
  it('keeps its historical message, and otherwise names the runtime', async () => {
    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: (): never => {
        throw new Error("Cannot find module '@modelcontextprotocol/sdk/server/index.js'");
      },
    }));
    try {
      const fresh = await import('../../../src/lib/mcp/mcpServe.js');
      await expect(fresh.mcpServe(SERVED)).rejects.toThrow(
        'mcpServe requires @modelcontextprotocol/sdk.\n' +
          '  Install:  npm install @modelcontextprotocol/sdk\n' +
          '  Or pass `_server` for test injection.',
      );
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }

    vi.resetModules();
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: (): never => {
        throw new TypeError('nodeModule.createRequire is not a function');
      },
    }));
    try {
      const fresh = await import('../../../src/lib/mcp/mcpServe.js');
      const failure = await fresh.mcpServe(SERVED).then(
        () => new Error('should have refused'),
        (e: Error) => e,
      );
      expect(failure.message).not.toContain('npm install');
      expect(failure.message).toContain('cannot run in a browser at all');
      expect(failure.message).toContain('`_server`');
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });
});
