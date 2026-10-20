import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Agent, defineTool } from '../../src/index.js';
import { anthropic, mock } from '../../src/doors/providers.js';
import { runArm, canaries, modules } from '../../bench/cache/pilot/arms.mjs';
import { pilotBudget, RESERVATION_MICRO_USD } from '../../bench/cache/pilot/budget.mjs';
import { openJournal } from '../../bench/cache/pilot/journal.mjs';
import { closureHash } from '../../bench/cache/pilot/identity.mjs';
import { liveTransport } from '../../bench/cache/pilot/live.mjs';
import { pilot } from '../../bench/cache/pilot/run.mjs';
const api = { Agent, defineTool, anthropic, mock };
describe('findings pilot free end-to-end setup', () => {
  it('loads the pinned package entries instead of an unhashed consumer self-reference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-self-reference-'));
    try {
      const pinned = join(dir, 'node_modules/af-baseline');
      mkdirSync(pinned, { recursive: true });
      writeFileSync(
        join(pinned, 'package.json'),
        JSON.stringify({
          name: 'agentfootprint',
          exports: {
            '.': { require: { default: './index.cjs' } },
            './providers': { require: { default: './providers.cjs' } },
          },
        }),
      );
      writeFileSync(join(pinned, 'index.cjs'), 'exports.Agent="verified";');
      writeFileSync(join(pinned, 'providers.cjs'), 'exports.mock="verified";');
      writeFileSync(
        join(dir, 'override.cjs'),
        'exports.Agent="UNVERIFIED";exports.mock="UNVERIFIED";',
      );
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'af-baseline',
          exports: {
            '.': './override.cjs',
            './providers': './override.cjs',
          },
        }),
      );
      expect(modules(dir, 'baseline')).toMatchObject({ Agent: 'verified', mock: 'verified' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('the pinned SDK ignores root self-reference and accepts fractional remaining deadlines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-sdk-self-reference-'));
    try {
      symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'), 'dir');
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: '@anthropic-ai/sdk', exports: { '.': './override.cjs' } }),
      );
      writeFileSync(
        join(dir, 'override.cjs'),
        'exports.default=class{constructor(){throw new Error("UNVERIFIED SDK EXECUTED")}};',
      );
      const network = vi.fn(
        async () =>
          new Response(JSON.stringify({ content: [], usage: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      await liveTransport(
        dir,
        'synthetic-not-a-secret',
        network,
      )(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'synthetic' }],
        },
        { timeout: 500.125, signal: new AbortController().signal },
      );
      expect(network).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('bad execution approval is refused before package or live client loading', async () => {
    const live = vi.fn();
    await expect(
      pilot({
        consumer: 'missing-consumer',
        output: 'must-not-exist.json',
        execute: true,
        approvedManifest: 'wrong',
        getLiveTransport: live,
      }),
    ).rejects.toThrow(/approval/);
    expect(live).not.toHaveBeenCalled();
  });
  it.each(['lookup', 'conflict'])(
    'the actual engine completes the scripted %s fixture with a summary only',
    async (scenario) => {
      const events = [];
      const budget = pilotBudget({
        journal: (e) => {
          events.push(e);
        },
      });
      const result = await runArm({
        api,
        arm: 'candidate',
        scenarioId: scenario,
        budget,
        partition: `stable-${scenario}-frozen-v1`,
      });
      expect(result.ended).toBe('complete');
      expect(result.plantedFidelity).toBe(true);
      expect(result.referenceRefusals).toBe(0);
      expect(result.toolsStable).toBe(true);
      expect(result.systemStable).toBe(true);
      expect(result.recordedIdentifiedStandingRows).toBeGreaterThan(0);
      expect(result.calls).toBe(scenario === 'lookup' ? 2 : 3);
      expect(Object.keys(result).sort()).toEqual(
        [
          'arm',
          'scenario',
          'ended',
          'calls',
          'reads',
          'plantedFidelity',
          'referenceRefusals',
          'recordedIdentifiedStandingRows',
          'recordedUnknownStandingRows',
          'extraTurns',
          'requestHashes',
          'toolsStable',
          'systemStable',
        ].sort(),
      );
      expect(result).not.toHaveProperty('answer');
      expect(result).not.toHaveProperty('frames');
      expect(budget.snapshot().reservedMicroUsd).toBe(result.calls * RESERVATION_MICRO_USD);
      expect(
        events
          .filter((e) => e.kind === 'settled')
          .every((e) => e.usage.raw.cache_read_input_tokens === 0),
      ).toBe(true);
    },
  );
  it('does not retain a provider answer even when it is not valid fixture JSON', async () => {
    const sentinel = 'PRIVATE_PROVIDER_ANSWER_MUST_NOT_BE_SAVED';
    const result = await runArm({
      api,
      arm: 'candidate',
      scenarioId: 'lookup',
      partition: 'stable-lookup-frozen-v1',
      budget: pilotBudget({ journal() {} }),
      transport: async () => ({
        id: 'msg_summary_fixture',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: sentinel }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    });
    expect(result.ended).toBe('complete');
    expect(result.plantedFidelity).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result).not.toHaveProperty('answer');
    expect(result).not.toHaveProperty('frames');
    expect(result.requestHashes).toHaveLength(1);
  });
  it('the shared real-library canaries cover valid, unserved, ambiguous and same-batch IDs', async () => {
    expect(await canaries(api)).toEqual([
      { name: 'valid', executes: 2, refuses: 0 },
      { name: 'unserved', executes: 0, refuses: 1 },
      { name: 'ambiguous', executes: 2, refuses: 1 },
      { name: 'same-batch', executes: 1, refuses: 1 },
    ]);
  });
  it('a process killed at transport entry leaves a reservation and cannot reopen its allowance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-crash-')),
      path = join(dir, 'journal.ndjson');
    try {
      const module = pathToFileURL(join(process.cwd(), 'bench/cache/pilot/journal.mjs')).href;
      const guard = pathToFileURL(join(process.cwd(), 'bench/cache/pilot/budget.mjs')).href;
      const code = `import {openJournal} from ${JSON.stringify(
        module,
      )};import {pilotBudget,MODEL} from ${JSON.stringify(
        guard,
      )};const j=openJournal(${JSON.stringify(
        path,
      )});await pilotBudget({journal:e=>j.append(e)}).call({model:MODEL,max_tokens:1,messages:[{role:'user',content:'synthetic'}]},()=>process.exit(73),{arm:'baseline',run:'lookup'});`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        timeout: 15000,
      });
      expect(child.status).toBe(73);
      const rows = readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(rows).toEqual([
        expect.objectContaining({ kind: 'reserved', microUsd: RESERVATION_MICRO_USD }),
      ]);
      expect(() => openJournal(path)).toThrow(/exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('closure admission catches edited files and links escaping the verified install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-identity-'));
    try {
      writeFileSync(join(dir, 'fixture.js'), 'export const fixture=1;');
      const before = closureHash(dir);
      writeFileSync(join(dir, 'fixture.js'), 'export const fixture=2;');
      expect(closureHash(dir)).not.toBe(before);
      symlinkSync(process.execPath, join(dir, 'outside-executable'));
      expect(() => closureHash(dir)).toThrow(/escapes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('the actual SDK transport pins one destination, no redirects, no retries and bounded response bytes', async () => {
    const network = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      expect(init.redirect).toBe('error');
      return new Response(
        JSON.stringify({
          id: 'msg_synthetic',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5-20251001',
          content: [{ type: 'text', text: 'synthetic' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const transport = liveTransport(process.cwd(), 'synthetic-not-a-secret', network);
    await transport(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'synthetic' }],
      },
      { maxRetries: 0, timeout: 50, signal: new AbortController().signal },
    );
    expect(network).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn(
      async () =>
        new Response('{"error":{"type":"overloaded_error","message":"synthetic"}}', {
          status: 529,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      liveTransport(
        process.cwd(),
        'synthetic-not-a-secret',
        unavailable,
      )(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'synthetic' }],
        },
        { maxRetries: 0, timeout: 50 },
      ),
    ).rejects.toThrow();
    expect(unavailable).toHaveBeenCalledTimes(1);
    const oversized = vi.fn(
      async () =>
        new Response('x'.repeat(131073), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      liveTransport(
        process.cwd(),
        'synthetic-not-a-secret',
        oversized,
      )(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'synthetic' }],
        },
        { maxRetries: 0, timeout: 500 },
      ),
    ).rejects.toThrow();
    expect(oversized).toHaveBeenCalledTimes(1);
  });
});
