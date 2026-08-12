/**
 * codeRunnerTool + the CodeRunner adapters (9.7.0).
 *
 * The tool exists to prove the session contract works, and to make the
 * "summarize prose, compute data" doctrine something you can actually run. So
 * the tests are about the two things that decide whether it is safe:
 *
 *   • the SESSION IS REUSED (otherwise the whole feature is a slower way to do
 *     what a closure already did), and
 *   • the session is reused ONLY within its isolation key (otherwise it is the
 *     cross-binding bug with better ergonomics).
 *
 * 7-pattern matrix:
 *   unit        — the render layer: truncation, non-zero exit, empty output
 *   scenario    — three calls in one turn share ONE interpreter
 *   integration — a real Agent run; a real `localCodeRunner` subprocess
 *   property    — the description the model reads matches the scope it got
 *   security    — two identities under one sessionId get two sandboxes; every
 *                 scope refusal names the door and the fix
 *   regression  — the session map is per key, not per tool; the symbol rides
 *                 alongside `flowchartAsTool`'s without collision
 *   performance — parallel calls in one iteration open ONE session, not two
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, codeRunnerTool, defineTool, toolSessionsOf } from '../../src/index.js';
import { INNER_RUN_RECORDS } from '../../src/lib/trace-toolpack/innerRunRecords.js';
import { localCodeRunner } from '../../src/adapters/code/local.js';
import { mock } from '../../src/llm-providers.js';
import type { CodeResult, CodeRunner, CodeSession } from '../../src/adapters/types.js';
import type { ToolExecutionContext } from '../../src/core/tools.js';
import { unconfiguredCredentialProvider } from '../../src/identity/types.js';

/** A runner that records what it was asked to do. */
function fakeRunner(answer: Partial<CodeResult> = {}): {
  runner: CodeRunner;
  starts: string[];
  stops: string[];
  codes: string[];
} {
  const starts: string[] = [];
  const stops: string[] = [];
  const codes: string[] = [];
  const runner: CodeRunner = {
    id: 'fake-runner',
    start: (req) => {
      starts.push(req.key);
      const session: CodeSession = {
        id: `s-${starts.length}`,
        execute: (exec) => {
          codes.push(exec.code);
          return Promise.resolve({ ok: true, stdout: 'out', stderr: '', ...answer });
        },
        stop: () => {
          stops.push(req.key);
          return Promise.resolve();
        },
      };
      return Promise.resolve(session);
    },
  };
  return { runner, starts, stops, codes };
}

function ctx(facts: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    toolCallId: 'call-1',
    iteration: 0,
    credentials: unconfiguredCredentialProvider(),
    hasCredentials: false,
    teardownScopes: ['call', 'run', 'session', 'shutdown'],
    onTeardown: () => {},
    ...facts,
  };
}

const codeCalls = (n: number) =>
  mock({
    replies: [
      ...Array.from({ length: n }, (_, i) => ({
        toolCalls: [{ id: `tc-${i}`, name: 'run_code', args: { code: `print(${i})` } }],
      })),
      { content: 'done' },
    ],
  });

// ─── scenario + performance: one session, many calls ──────────────────────

describe('one session, many calls', () => {
  it('SCENARIO — three calls in one turn share ONE interpreter, and it closes once', async () => {
    const { runner, starts, stops, codes } = fakeRunner();
    const agent = Agent.create({ provider: codeCalls(3), model: 'm', maxIterations: 6 })
      .tool(codeRunnerTool({ runner }))
      .build();

    await agent.run({ message: 'compute' });

    // The whole value of the feature: start-up paid once.
    expect(starts).toHaveLength(1);
    expect(codes).toEqual(['print(0)', 'print(1)', 'print(2)']);
    expect(stops).toEqual(starts);
  });

  it('two runs get two sessions — a run-scoped sandbox does not outlive its turn', async () => {
    const { runner, starts } = fakeRunner();
    const tool = codeRunnerTool({ runner });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'run_code', args: { code: '1' } }] },
          { content: 'one' },
          { toolCalls: [{ id: 'b', name: 'run_code', args: { code: '2' } }] },
          { content: 'two' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(tool)
      .build();

    await agent.run({ message: 'first' });
    await agent.run({ message: 'second' });

    expect(starts).toHaveLength(2);
    expect(starts[0]).not.toBe(starts[1]);
    // The map is emptied by the teardown it registered alongside each session,
    // so it cannot outlive what it points at.
    expect(toolSessionsOf(tool)?.size).toBe(0);
  });

  it("SECURITY — a 'session'-scoped tool keys on tenant+principal+session, not the session alone", async () => {
    const { runner, starts } = fakeRunner();
    const tool = codeRunnerTool({ runner, scope: 'session' });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'run_code', args: { code: '1' } }] },
          { content: 'one' },
          { toolCalls: [{ id: 'b', name: 'run_code', args: { code: '2' } }] },
          { content: 'two' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(tool)
      .build();

    // Same sessionId — which is CALLER DATA, and anyone who can reach the host
    // can put someone else's there. Two principals must not share a sandbox.
    await agent.run(
      { message: 'a', identity: { principal: 'ada', conversationId: 'c' } },
      { sessionId: 'sess-1' },
    );
    await agent.run(
      { message: 'b', identity: { principal: 'bob', conversationId: 'c' } },
      { sessionId: 'sess-1' },
    );

    expect(starts).toHaveLength(2);
    expect(starts[0]).toContain('p=ada');
    expect(starts[1]).toContain('p=bob');

    await agent.closeToolSessions({ sessionId: 'sess-1' });
    expect(toolSessionsOf(tool)?.size).toBe(0);
  });

  it("a 'session'-scoped session SURVIVES the turn that opened it", async () => {
    const { runner, starts, stops } = fakeRunner();
    const tool = codeRunnerTool({ runner, scope: 'session' });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'run_code', args: { code: '1' } }] },
          { content: 'one' },
          { toolCalls: [{ id: 'b', name: 'run_code', args: { code: '2' } }] },
          { content: 'two' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(tool)
      .build();

    await agent.run({ message: 'turn one' }, { sessionId: 'sess-1' });
    await agent.run({ message: 'turn two' }, { sessionId: 'sess-1' });

    // One interpreter across two turns: this is what "variables persist between
    // turns" actually is.
    expect(starts).toHaveLength(1);
    expect(stops).toHaveLength(0);

    await agent.closeToolSessions({ sessionId: 'sess-1' });
    expect(stops).toHaveLength(1);
  });

  it('PERFORMANCE — two parallel calls in one iteration open ONE session', async () => {
    const { runner, starts } = fakeRunner();
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'a', name: 'run_code', args: { code: '1' } },
              { id: 'b', name: 'run_code', args: { code: '2' } },
            ],
          },
          { content: 'done' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(codeRunnerTool({ runner }))
      .build();

    await agent.run({ message: 'go' });

    expect(starts).toHaveLength(1);
  });
});

// ─── security: the refusals ───────────────────────────────────────────────

describe('degradation is refused, never silent', () => {
  const { runner } = fakeRunner();

  it("scope 'session' with no sessionId REFUSES and names the fix", async () => {
    const tool = codeRunnerTool({ runner, scope: 'session' });
    await expect(tool.execute({ code: 'x' }, ctx({ runId: 'r1' }))).rejects.toThrow(
      /scope 'session' needs a hosting session/,
    );
    // Not narrowed to 'run' behind the caller's back: the two differ by ~30x in
    // start-up cost and by everything in what persists between turns.
    await expect(tool.execute({ code: 'x' }, ctx({ runId: 'r1' }))).rejects.toThrow(
      /not silently narrowed/,
    );
  });

  it("scope 'run' with no run REFUSES — a served call is one call, not a turn", async () => {
    const tool = codeRunnerTool({ runner });
    await expect(tool.execute({ code: 'x' }, ctx())).rejects.toThrow(/scope 'run' needs a run/);
  });

  it('a door that honours NO scope refuses before anything is opened', async () => {
    const { runner: r, starts } = fakeRunner();
    const tool = codeRunnerTool({ runner: r });
    await expect(
      tool.execute({ code: 'x' }, ctx({ runId: 'r1', teardownScopes: [] })),
    ).rejects.toThrow(/A session nothing will ever close is a sandbox left running/);
    expect(starts).toHaveLength(0);
  });

  it("a call-scoped tool works at a door that only honours 'call' (mcpServe's shape)", async () => {
    const { runner: r, starts } = fakeRunner();
    const tool = codeRunnerTool({ runner: r, scope: 'call' });
    await expect(tool.execute({ code: 'x' }, ctx({ teardownScopes: ['call'] }))).resolves.toContain(
      'out',
    );
    expect(starts).toEqual(['c=call-1']);
  });
});

// ─── unit: what the model reads back ──────────────────────────────────────

describe('the result the model reads', () => {
  const run = (answer: Partial<CodeResult>, opts = {}) => {
    const { runner } = fakeRunner(answer);
    return codeRunnerTool({ runner, ...opts }).execute({ code: 'x' }, ctx({ runId: 'r1' }));
  };

  it('SILENT SUCCESS — a cut the TOOL makes is stated in the result', async () => {
    const out = await run({ stdout: 'x'.repeat(50) }, { maxOutputChars: 10 });
    // The model goes on to reason over this. A slice it cannot see is a
    // fragment of a table it believes is the table.
    expect(out).toContain('[truncated: showing 10 of 50 characters');
    expect(out).toContain('summary, a slice, or an aggregate');
  });

  it('SILENT SUCCESS — a cut the RUNNER already made is stated too', async () => {
    // The runner clipped upstream and reported it; the tool must not pass that
    // through as if the output were whole just because it fits the tool's own
    // ceiling.
    const out = await run({ stdout: 'short', truncated: { stdout: true, ofChars: 90_000 } });
    expect(out).toContain('[truncated:');
  });

  it('output that fits carries NO truncation marker', async () => {
    expect(await run({ stdout: 'fine' })).toBe('fine');
  });

  it('a non-zero exit is a RESULT, not a thrown tool error — the model has to read it', async () => {
    const out = await run({ ok: false, exitCode: 1, stdout: '', stderr: 'NameError: x' });
    expect(out).toContain('NameError: x');
    expect(out).toContain('[exit 1]');
  });

  it('code that printed nothing says so, rather than returning an empty string', async () => {
    const out = await run({ stdout: '', stderr: '' });
    expect(out).toContain('printed nothing');
  });

  it('artifacts are DESCRIBED, never inlined — that is the whole doctrine', async () => {
    const out = await run({
      stdout: 'saved',
      artifacts: [{ name: 'report.csv', bytes: 4_000_000, uri: 's3://b/report.csv' }],
    });
    expect(out).toContain('[artifact: report.csv, 4000000 bytes, s3://b/report.csv]');
    expect(out.length).toBeLessThan(500);
  });
});

// ─── property: the description matches the scope ──────────────────────────

describe('what the model is told about persistence matches what it gets', () => {
  const { runner } = fakeRunner();
  it.each([
    ['call' as const, /fresh environment/],
    ['run' as const, /within this turn/],
    ['session' as const, /across the whole conversation/],
  ])('scope %s describes itself honestly', (scope, expected) => {
    expect(codeRunnerTool({ runner, scope }).schema.description).toMatch(expected);
  });

  it('every scope tells the model to COMPUTE rather than ask for the data', () => {
    for (const scope of ['call', 'run', 'session'] as const) {
      expect(codeRunnerTool({ runner, scope }).schema.description).toMatch(/COMPUTE over data/);
    }
  });
});

// ─── regression: compose, don't collide ───────────────────────────────────

describe('compose, do not collide', () => {
  it('the session map rides its OWN symbol, beside an inner-record store', () => {
    const { runner } = fakeRunner();
    const tool = codeRunnerTool({ runner });
    // Spreading a tool preserves symbol keys, which is what lets one tool carry
    // both registries — the same move `flowchartAsTool({ keepRecord })` makes.
    const both = { ...tool, [INNER_RUN_RECORDS]: { get: () => undefined, keep: () => {} } };
    expect(toolSessionsOf(both)).toBeDefined();
    expect(both[INNER_RUN_RECORDS]).toBeDefined();
  });

  it('a plain tool holds no sessions, and saying so does not throw', () => {
    const plain = defineTool({ name: 'x', description: 'y', execute: () => 'z' });
    expect(toolSessionsOf(plain)).toBeUndefined();
    expect(toolSessionsOf(null)).toBeUndefined();
    expect(toolSessionsOf('not a tool')).toBeUndefined();
  });
});

// ─── integration: a real subprocess ───────────────────────────────────────

describe('localCodeRunner — isolation, not a sandbox', () => {
  it('runs real code in a child process and returns its stdout', async () => {
    const runner = localCodeRunner();
    const session = await runner.start({ key: 'k', language: 'javascript' });
    const result = await session.execute({ code: 'console.log(6*7)', language: 'javascript' });
    await session.stop();

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe('42');
  });

  it('SECURITY — the child environment is an ALLOWLIST, never `process.env`', async () => {
    process.env.AF_TEST_LEAK_CANARY = 'should-not-be-visible';
    try {
      const runner = localCodeRunner();
      const session = await runner.start({ key: 'k', language: 'javascript' });
      const result = await session.execute({
        code: 'console.log(JSON.stringify(process.env.AF_TEST_LEAK_CANARY ?? null))',
        language: 'javascript',
      });
      await session.stop();

      // A credential sitting in this process's environment is not handed to
      // model-written code by default. That is the one real security property
      // this adapter has, and it is worth a test rather than a sentence.
      expect(result.stdout.trim()).toBe('null');
    } finally {
      delete process.env.AF_TEST_LEAK_CANARY;
    }
  });

  it('a non-zero exit comes back as a RESULT carrying the traceback', async () => {
    const runner = localCodeRunner();
    const session = await runner.start({ key: 'k', language: 'javascript' });
    const result = await session.execute({
      code: 'throw new Error("boom")',
      language: 'javascript',
    });
    await session.stop();

    // The model wrote the code and needs to read what broke. Turning this into
    // a thrown tool error would replace the one thing that teaches the retry.
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('boom');
  });

  it('output past the ceiling is CUT and the cut is reported', async () => {
    const runner = localCodeRunner({ maxOutputChars: 20 });
    const session = await runner.start({ key: 'k', language: 'javascript' });
    const result = await session.execute({
      code: "console.log('y'.repeat(500))",
      language: 'javascript',
    });
    await session.stop();

    expect(result.stdout.length).toBe(20);
    expect(result.truncated).toMatchObject({ stdout: true });
    expect(result.truncated?.ofChars).toBeGreaterThan(400);
  });

  it('an unknown language refuses by name rather than guessing an interpreter', async () => {
    const runner = localCodeRunner();
    const session = await runner.start({ key: 'k' });
    await expect(session.execute({ code: 'x', language: 'brainfuck' })).rejects.toThrow(
      /no command for language 'brainfuck'/,
    );
  });

  it('a stopped session refuses later executions instead of silently starting a new process', async () => {
    const runner = localCodeRunner();
    const session = await runner.start({ key: 'k', language: 'javascript' });
    await session.stop();
    await expect(session.execute({ code: 'console.log(1)' })).rejects.toThrow(/was stopped/);
  });

  it('the module says what it is — "isolation, not a sandbox", in the source', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/adapters/code/local.ts', import.meta.url),
      'utf8',
    );
    // A stated limit whose statement was deleted is back to being a claim
    // nobody checked. `vm`/`eval` are refused in the same breath.
    expect(source).toContain('ISOLATION, NOT A SANDBOX');
    expect(source).toMatch(/refused outright/);
    expect(source).not.toMatch(/\bnew Function\(|\brequire\('node:vm'\)/);
  });
});

// ─── integration: through a real Agent ────────────────────────────────────

describe('through a real Agent, end to end', () => {
  it('the model writes code, the runner computes, the ANSWER comes back', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'tc-1', name: 'run_code', args: { code: 'console.log([1,2,3].length)' } },
            ],
          },
          { content: 'There are 3.' },
        ],
      }),
      model: 'm',
      maxIterations: 4,
    })
      .tool(codeRunnerTool({ runner: localCodeRunner(), language: 'javascript' }))
      .build();

    await expect(agent.run({ message: 'how many?' })).resolves.toBe('There are 3.');
  });

  it('the session is released even when the turn CRASHES', async () => {
    const stop = vi.fn(() => Promise.resolve());
    const runner: CodeRunner = {
      id: 'crashy',
      start: () =>
        Promise.resolve({
          id: 's1',
          execute: () => Promise.resolve({ ok: true, stdout: '', stderr: '' }),
          stop,
        }),
    };
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'tc-1', name: 'run_code', args: { code: 'x' } }] }],
      }),
      model: 'm',
    })
      .tool(codeRunnerTool({ runner }))
      .build();

    await expect(agent.run({ message: 'go' })).rejects.toThrow();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
