/**
 * Code staging-in (9.26.0) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The gap this closes, in the library's own words: 9.22.0 shipped mint-on-OUTPUT
 * and stated the honest cut — "the `CodeSession` port's only input is the code
 * string; declared input refs wait for a session file-write verb on the port."
 * `CodeSession.stageInputs` is that verb, and `codeRunnerTool({ wants })` is
 * what uses it.
 *
 * The laws being pinned:
 *   • THE ZERO-DELTA PIN — no `wants` ⇒ no schema properties, no staging call,
 *     no environment variable, no filesystem module loaded, and the description
 *     is the one earlier releases composed.
 *   • The DATA is what lands in the session, and the model's code reads it by
 *     the manifest — the ref never becomes the file's contents and the data
 *     never enters the context window.
 *   • REFUSED, never degraded: a runner whose sessions cannot stage refuses by
 *     name rather than running code against files that are not there.
 *   • The manifest reaches the code as ONE environment variable, on every
 *     backend that stages.
 *   • Staged inputs live as long as the session and are released by `stop()`.
 *   • A caller-supplied name lands as one inert file-name segment.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, codeRunnerTool, inMemoryArtifacts } from '../../src/index.js';
import { canStageCodeInputs, STAGED_INPUTS_ENV } from '../../src/index.js';
import type { CodeRunner, CodeSession } from '../../src/index.js';
import { localCodeRunner } from '../../src/adapters/code/local.js';
import { mock } from '../../src/llm-providers.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Capture what the child process would have been given — INCLUDING the staged
 * files as the code would have seen them.
 *
 * Reading them here rather than after the run is the honest assertion: the
 * session's staging directory lives as long as the session, and a run-scoped
 * session is torn down when the turn ends. A test that read the files
 * afterwards would be asserting against a leak.
 */
function spyChildProcess(): {
  module: { execFile: (...args: unknown[]) => unknown };
  calls: {
    args: string[];
    env: Record<string, string>;
    cwd: string;
    staged: Record<string, string>;
  }[];
} {
  const calls: {
    args: string[];
    env: Record<string, string>;
    cwd: string;
    staged: Record<string, string>;
  }[] = [];
  return {
    calls,
    module: {
      execFile: (_file: unknown, args: unknown, options: unknown, callback: unknown): unknown => {
        const opts = options as { env: Record<string, string>; cwd: string };
        const manifest = JSON.parse(opts.env[STAGED_INPUTS_ENV] ?? '{}') as Record<string, string>;
        const staged: Record<string, string> = {};
        for (const [name, path] of Object.entries(manifest)) {
          staged[name] = readFileSync(path, 'utf8');
        }
        calls.push({ args: args as string[], env: opts.env, cwd: opts.cwd, staged });
        (callback as (e: null, out: string, err: string) => void)(null, 'ok', '');
        return undefined;
      },
    },
  };
}

/** A runner whose sessions CANNOT stage — the absent-never-faked case. */
const nonStagingRunner: CodeRunner = {
  id: 'no-staging',
  start: () =>
    Promise.resolve({
      id: 'x',
      execute: () => Promise.resolve({ ok: true, stdout: 'ran', stderr: '' }),
      stop: () => Promise.resolve(),
    } as CodeSession),
};

// ─── 1. UNIT — the feature detector + the local implementation ───────

describe('canStageCodeInputs — unit', () => {
  it('reads the member rather than assuming it from the adapter name', async () => {
    const local = await localCodeRunner().start({ key: 'k' });
    expect(canStageCodeInputs(local)).toBe(true);
    const bare = await nonStagingRunner.start({ key: 'k' });
    expect(canStageCodeInputs(bare)).toBe(false);
  });
});

describe('localCodeRunner.stageInputs — unit', () => {
  it('writes the bytes, returns the paths, and exposes ONE manifest variable', async () => {
    const spy = spyChildProcess();
    const root = mkdtempSync(join(tmpdir(), 'af-stage-root-'));
    try {
      const runner = localCodeRunner({ _childProcess: spy.module, _stagingRoot: root });
      const session = await runner.start({ key: 'k', language: 'python' });
      const landed = await session.stageInputs?.([
        { name: 'dataset.json', data: '[{"q":"Q3"}]', mediaType: 'application/json' },
      ]);
      expect(landed).toHaveLength(1);
      expect(landed?.[0]?.name).toBe('dataset.json');
      expect(landed?.[0]?.bytes).toBe(12);
      expect(readFileSync(landed?.[0]?.path as string, 'utf8')).toBe('[{"q":"Q3"}]');

      await session.execute({ code: 'print(1)', language: 'python' });
      const manifest = JSON.parse(spy.calls[0]?.env[STAGED_INPUTS_ENV] ?? '{}') as Record<
        string,
        string
      >;
      expect(manifest['dataset.json']).toBe(landed?.[0]?.path);

      // Staged inputs live as long as the SESSION.
      await session.execute({ code: 'print(2)', language: 'python' });
      expect(spy.calls[1]?.env[STAGED_INPUTS_ENV]).toBeDefined();

      // …and are released by stop().
      const dir = (landed?.[0]?.path as string).slice(
        0,
        (landed?.[0]?.path as string).lastIndexOf('/'),
      );
      await session.stop();
      expect(existsSync(dir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ZERO-DELTA: a session that never stages passes the env it always did', async () => {
    const spy = spyChildProcess();
    const runner = localCodeRunner({ _childProcess: spy.module, env: { API_BASE: 'x' } });
    const session = await runner.start({ key: 'k', language: 'python' });
    await session.execute({ code: 'print(1)', language: 'python' });
    expect(Object.keys(spy.calls[0]?.env ?? {}).sort()).toEqual(['API_BASE', 'PATH']);
    expect(spy.calls[0]?.env[STAGED_INPUTS_ENV]).toBeUndefined();
    await session.stop();
  });

  it('the manifest is not overridable by operator env — it is a FACT of the run', async () => {
    const spy = spyChildProcess();
    const root = mkdtempSync(join(tmpdir(), 'af-stage-root-'));
    try {
      const runner = localCodeRunner({
        _childProcess: spy.module,
        _stagingRoot: root,
        env: { [STAGED_INPUTS_ENV]: '{"lies":"/nowhere"}' },
      });
      const session = await runner.start({ key: 'k' });
      await session.stageInputs?.([{ name: 'a.json', data: '1' }]);
      await session.execute({ code: 'x', language: 'python' });
      expect(spy.calls[0]?.env[STAGED_INPUTS_ENV]).not.toContain('nowhere');
      await session.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── 2. SECURITY — a caller name lands as one inert segment ──────────

describe('localCodeRunner.stageInputs — security', () => {
  it('a hostile name becomes a literal file name, never a path hop', async () => {
    const spy = spyChildProcess();
    const root = mkdtempSync(join(tmpdir(), 'af-stage-root-'));
    try {
      const runner = localCodeRunner({ _childProcess: spy.module, _stagingRoot: root });
      const session = await runner.start({ key: 'k' });
      const landed = await session.stageInputs?.([
        { name: '../../etc/passwd', data: 'nope' },
        { name: 'a/b.json', data: '1' },
      ]);
      for (const entry of landed ?? []) {
        // Everything after the staging directory is ONE segment.
        expect(entry.path.startsWith(root)).toBe(true);
        const tail = entry.path.slice(root.length + 1);
        expect(tail.split('/')).toHaveLength(2);
      }
      // Nothing escaped the staging directory.
      const dir = (landed?.[0]?.path as string).slice(
        0,
        (landed?.[0]?.path as string).lastIndexOf('/'),
      );
      expect(readdirSync(dir).sort()).toEqual(['____etc_passwd', 'a_b.json']);
      await session.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── 3. INTEGRATION — the tool ───────────────────────────────────────

describe('codeRunnerTool({ wants }) — integration', () => {
  async function runWithWants(runner: CodeRunner, refExists = true) {
    const store = inMemoryArtifacts();
    const scope = { conversationId: 'c1' };
    const put = await store.put(scope, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: [{ q: 'Q3', total: 42 }],
      label: 'Q3 rows',
    });
    const ref = refExists ? put.meta.ref : 'art_doesnotexist000000000';
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              {
                id: '1',
                name: 'run_code',
                args: { code: 'print(1)', dataset: ref },
              },
            ],
          },
          { content: 'done' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
      artifacts: { store },
    })
      .tool(codeRunnerTool({ runner, wants: { dataset: 'dataset/rows' }, language: 'python' }))
      .build();
    const results: string[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      results.push(String((e as { payload?: { result?: unknown } }).payload?.result ?? '')),
    );
    await agent.run({ message: 'go', identity: scope });
    return { results, store };
  }

  it('stages the RESOLVED data, not the ref, and tells the model it did', async () => {
    const spy = spyChildProcess();
    const root = mkdtempSync(join(tmpdir(), 'af-stage-root-'));
    try {
      const runner = localCodeRunner({ _childProcess: spy.module, _stagingRoot: root });
      const { results } = await runWithWants(runner);
      // The manifest is keyed by the ARGUMENT NAME — what the description told
      // the model to look up — and the file behind it carries the DATA, not
      // the ~26-character ticket.
      const staged = spy.calls[0]?.staged ?? {};
      expect(Object.keys(staged)).toEqual(['dataset']);
      expect(JSON.parse(staged.dataset as string)).toEqual([{ q: 'Q3', total: 42 }]);
      // The file itself got a familiar extension from the artifact's own
      // media type, without the manifest key drifting.
      const path = JSON.parse(spy.calls[0]?.env[STAGED_INPUTS_ENV] ?? '{}') as Record<
        string,
        string
      >;
      expect(path.dataset?.endsWith('/dataset.json')).toBe(true);
      // …and the result says what was put in, before what came out.
      expect(results[0]).toContain('staged into this session');
      expect(results[0]).toContain(STAGED_INPUTS_ENV);
      // The code the model wrote was NOT rewritten — staging is beside it.
      expect(spy.calls[0]?.args.at(-1)).toBe('print(1)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('REFUSES rather than running against files that are not there', async () => {
    const { results } = await runWithWants(nonStagingRunner);
    expect(results[0]).toContain('cannot put data into its own session');
    expect(results[0]).toContain('stageInputs');
    // Named, with the fix, and it did not silently run.
    expect(results[0]).not.toContain('ran');
  });

  it('a stale ref never reaches the tool — the wants refusal comes first', async () => {
    const { results } = await runWithWants(
      localCodeRunner({ _childProcess: spyChildProcess().module }),
      false,
    );
    expect(results[0]).toContain('does not resolve in this run');
  });
});

// ─── 4. ZERO-DELTA — the tool without wants ──────────────────────────

describe('codeRunnerTool — zero-delta without wants', () => {
  it('adds no schema property and never asks a session to stage', async () => {
    const spy = spyChildProcess();
    const tool = codeRunnerTool({
      runner: localCodeRunner({ _childProcess: spy.module }),
      language: 'python',
    });
    expect(Object.keys(tool.schema.inputSchema?.properties ?? {})).toEqual(['code']);
    expect(tool.wants).toBeUndefined();
    // The description is the one earlier releases composed.
    expect(tool.schema.description).not.toContain(STAGED_INPUTS_ENV);

    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: '1', name: 'run_code', args: { code: 'print(1)' } }] },
          { content: 'done' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(tool)
      .build();
    const results: string[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      results.push(String((e as { payload?: { result?: unknown } }).payload?.result ?? '')),
    );
    await agent.run({ message: 'go' });
    expect(results[0]).toBe('ok');
    expect(spy.calls[0]?.env[STAGED_INPUTS_ENV]).toBeUndefined();
  });
});

// ─── 5. UNIT — the composed description teaches the mechanism ────────

describe('codeRunnerTool({ wants }) — the description', () => {
  it('names the argument, the variable, and a one-line example in the tool language', () => {
    const python = codeRunnerTool({
      runner: nonStagingRunner,
      language: 'python',
      wants: { dataset: 'dataset/rows' },
    });
    expect(python.schema.description).toContain("'dataset'");
    expect(python.schema.description).toContain(STAGED_INPUTS_ENV);
    expect(python.schema.description).toContain('json.loads');

    const js = codeRunnerTool({
      runner: nonStagingRunner,
      language: 'javascript',
      wants: { rows: 'dataset/rows' },
    });
    expect(js.schema.description).toContain('JSON.parse(process.env');
  });

  it('declares each wants-argument as a STRING the model fills with a ref', () => {
    const tool = codeRunnerTool({
      runner: nonStagingRunner,
      wants: { dataset: 'dataset/rows' },
    });
    const props = tool.schema.inputSchema?.properties as Record<string, { type?: string }>;
    expect(props.dataset?.type).toBe('string');
    expect(Object.keys(props).sort()).toEqual(['code', 'dataset']);
  });
});

// ─── 6. PROPERTY — every declared argument the model passes is staged ─

describe('codeRunnerTool({ wants }) — property', () => {
  it('an argument the model did NOT pass is simply not staged', async () => {
    const spy = spyChildProcess();
    const root = mkdtempSync(join(tmpdir(), 'af-stage-root-'));
    try {
      const store = inMemoryArtifacts();
      const scope = { conversationId: 'c1' };
      const a = await store.put(scope, {
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: [1],
      });
      const agent = Agent.create({
        provider: mock({
          replies: [
            {
              toolCalls: [{ id: '1', name: 'run_code', args: { code: 'x', first: a.meta.ref } }],
            },
            { content: 'done' },
          ],
        }),
        model: 'm',
        maxIterations: 4,
        artifacts: { store },
      })
        .tool(
          codeRunnerTool({
            runner: localCodeRunner({ _childProcess: spy.module, _stagingRoot: root }),
            wants: { first: 'dataset/rows', second: 'dataset/rows' },
          }),
        )
        .build();
      await agent.run({ message: 'go', identity: scope });
      expect(Object.keys(spy.calls[0]?.staged ?? {})).toEqual(['first']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('NONE passed: the code still runs (optional inputs are legitimate) and the result SAYS nothing was staged', async () => {
    // The absence a model would otherwise debug: its code reads
    // AF_STAGED_INPUTS, the variable is not set, and nothing in the
    // conversation explains why. Stated in the result rather than left to a
    // traceback — while an unrelated call that needs no stored data still runs.
    const spy = spyChildProcess();
    const root = mkdtempSync(join(tmpdir(), 'af-stage-root-'));
    try {
      const agent = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: '1', name: 'run_code', args: { code: 'print(1)' } }] },
            { content: 'done' },
          ],
        }),
        model: 'm',
        maxIterations: 4,
        artifacts: { store: inMemoryArtifacts() },
      })
        .tool(
          codeRunnerTool({
            runner: localCodeRunner({ _childProcess: spy.module, _stagingRoot: root }),
            wants: { dataset: 'dataset/rows' },
          }),
        )
        .build();
      const ends: Record<string, unknown>[] = [];
      agent.on('agentfootprint.stream.tool_end', (e) =>
        ends.push(e.payload as Record<string, unknown>),
      );
      await agent.run({ message: 'go' });
      // The code ran — nothing was refused.
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]?.env[STAGED_INPUTS_ENV]).toBeUndefined();
      const text = String(ends[0]?.result);
      expect(text).toContain('no artifact inputs were passed');
      expect(text).toContain(STAGED_INPUTS_ENV);
      expect(text).toContain("'dataset'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── 7. ROI — data goes both ways without entering the window ────────

describe('code staging — ROI', () => {
  it('a big payload reaches the interpreter without one byte of it in the prompt', async () => {
    const spy = spyChildProcess();
    const root = mkdtempSync(join(tmpdir(), 'af-stage-root-'));
    try {
      const store = inMemoryArtifacts({ retention: { maxBytesPerScope: 10_000_000 } });
      const scope = { conversationId: 'c1' };
      const rows = Array.from({ length: 5000 }, (_v, i) => ({ i, name: `row-${i}` }));
      const put = await store.put(scope, {
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: rows,
      });
      const agent = Agent.create({
        provider: mock({
          replies: [
            {
              toolCalls: [
                { id: '1', name: 'run_code', args: { code: 'agg()', dataset: put.meta.ref } },
              ],
            },
            { content: 'done' },
          ],
        }),
        model: 'm',
        maxIterations: 4,
        artifacts: { store },
      })
        .tool(
          codeRunnerTool({
            runner: localCodeRunner({ _childProcess: spy.module, _stagingRoot: root }),
            wants: { dataset: 'dataset/rows' },
          }),
        )
        .build();
      await agent.run({ message: 'go', identity: scope });

      // The interpreter got the whole dataset…
      const staged = spy.calls[0]?.staged.dataset ?? '';
      expect((JSON.parse(staged) as unknown[]).length).toBe(5000);
      expect(staged.length).toBeGreaterThan(100_000);
      // …and the argv the model's code travelled in carries only the code.
      const argv = (spy.calls[0]?.args ?? []).join(' ');
      expect(argv).not.toContain('row-4999');
      expect(argv.length).toBeLessThan(200);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
