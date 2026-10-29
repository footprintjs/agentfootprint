/**
 * `codeRunnerTool` — an outcome the runner did not report stays UNKNOWN, in
 * the result the model reads and in the record the run keeps.
 *
 * `CodeResult.ok` became optional: absent means the backend reported neither
 * an exit status nor an error verdict. Before, `agentCoreCodeRunner` filled
 * `ok: true` from that silence, the model read a clean run, and the
 * `tools.code_run` record said `ok: true`. Now the model reads a stated
 * unknown, and the record carries no `ok` at all.
 */

import { describe, expect, it } from 'vitest';

import { Agent, CodeSandboxError, codeRunnerTool, codeRunsOf } from '../../src/index.js';
import { agentCoreCodeRunner } from '../../src/adapters/code/agentcore.js';
import { localCodeRunner } from '../../src/adapters/code/local.js';
import { mock } from '../../src/llm-providers.js';
import { unconfiguredCredentialProvider } from '../../src/identity/types.js';
import type { CodeResult, CodeRunner } from '../../src/provider-contract/types.js';
import type { ToolExecutionContext } from '../../src/tools/tools.js';
import { AWS_COMMAND_PINS, fakeSdk } from '../adapters/aws/awsCommandPin.js';
import { spawnErroringAfterStart } from '../adapters/code/childSeam.js';

function runnerAnswering(result: CodeResult): CodeRunner {
  return {
    id: 'answering',
    start: () =>
      Promise.resolve({
        id: 's1',
        execute: () => Promise.resolve(result),
        stop: () => Promise.resolve(),
      }),
  };
}

const ctx: ToolExecutionContext = {
  toolCallId: 'c1',
  iteration: 0,
  credentials: unconfiguredCredentialProvider(),
  hasCredentials: false,
  runId: 'r1',
  teardownScopes: ['call', 'run', 'session', 'shutdown'],
  onTeardown: () => {},
};

describe('codeRunnerTool — what the model reads about an outcome', () => {
  it('NO REPORTED OUTCOME is stated as unknown, anchored to the call it answers', async () => {
    const tool = codeRunnerTool({ runner: runnerAnswering({ stdout: '42', stderr: '' }) });
    const out = await tool.execute({ code: 'print(42)' }, ctx);
    expect(out).toContain('42');
    expect(out).toContain(
      '[exit status unknown: the code runner reported neither an exit status nor an error for ' +
        'the run_code call this result answers, so whether that code finished is not known]',
    );
    // Not dressed up as either verdict.
    expect(out).not.toContain('did not complete successfully');
    expect(out).not.toContain('printed nothing');
  });

  it('a reported success adds no line; a reported failure keeps its own', async () => {
    const clean = await codeRunnerTool({
      runner: runnerAnswering({ ok: true, stdout: 'fine', stderr: '' }),
    }).execute({ code: 'x' }, ctx);
    expect(clean).toBe('fine');
    const failed = await codeRunnerTool({
      runner: runnerAnswering({ ok: false, exitCode: 1, stdout: '', stderr: 'NameError' }),
    }).execute({ code: 'x' }, ctx);
    expect(failed).toContain('[exit 1] the code did not complete successfully');
    expect(failed).not.toContain('exit status unknown');
  });

  it('the RECORD carries no ok when none was reported — never ok: true from silence', async () => {
    const unknown = codeRunnerTool({ runner: runnerAnswering({ stdout: '', stderr: '' }) });
    await unknown.execute({ code: 'x' }, ctx);
    const facts = codeRunsOf(unknown)?.get('c1');
    expect(facts).toBeDefined();
    expect('ok' in (facts ?? {})).toBe(false);

    const known = codeRunnerTool({
      runner: runnerAnswering({ ok: false, stdout: '', stderr: '' }),
    });
    await known.execute({ code: 'x' }, ctx);
    expect(codeRunsOf(known)?.get('c1')?.ok).toBe(false);
  });
});

describe('end to end — AgentCore reports nothing, and nothing is claimed', () => {
  it('the model reads "unknown" and tools.code_run carries no ok', async () => {
    const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'agentCoreCodeRunner');
    const sdk = fakeSdk(row!, {
      StartCodeInterpreterSessionCommand: { sessionId: 'ci-9' },
      // A result with output and no exit status and no error flag — the shape
      // that used to come back as `ok: true`.
      InvokeCodeInterpreterCommand: () => ({
        stream: (async function* () {
          yield { result: { content: [], structuredContent: { stdout: 'rows: 12\n' } } };
        })(),
      }),
      StopCodeInterpreterSessionCommand: {},
    });
    const runner = agentCoreCodeRunner({ identifier: 'aws.codeinterpreter.v1', _sdk: sdk.module });
    const toolResults: string[] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (request) => {
          const tool = request.messages.find((m) => m.role === 'tool');
          if (tool === undefined) {
            return { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: 'print(12)' } }] };
          }
          toolResults.push(String(tool.content));
          return { content: 'done' };
        },
      }),
      model: 'mock',
      maxIterations: 3,
    })
      .tool(codeRunnerTool({ runner }))
      .build();
    const payloads: Record<string, unknown>[] = [];
    agent.on('agentfootprint.tools.code_run', (e) => payloads.push({ ...e.payload }));

    await agent.run({ message: 'count the rows' });

    expect(toolResults[0]).toContain('rows: 12');
    expect(toolResults[0]).toContain('[exit status unknown');
    expect(payloads).toHaveLength(1);
    expect('ok' in (payloads[0] ?? {})).toBe(false);
    expect(payloads[0]).toMatchObject({ tool: 'run_code', language: 'python' });
  });
});

describe('the code-run record tells a failed program from an unconfirmed run', () => {
  /**
   * One AgentCore answer, driven end to end: the real SDK shim, the adapter,
   * `codeRunnerTool` and a real Agent. Returns what the adapter reported, what
   * the model read, and the `tools.code_run` record.
   */
  async function through(events: Record<string, unknown>[]): Promise<{
    result: CodeResult;
    read: string;
    record: Record<string, unknown>;
  }> {
    const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'agentCoreCodeRunner');
    const sdk = fakeSdk(row!, {
      StartCodeInterpreterSessionCommand: { sessionId: 'ci-7' },
      InvokeCodeInterpreterCommand: () => ({
        stream: (async function* () {
          for (const event of events) yield event;
        })(),
      }),
      StopCodeInterpreterSessionCommand: {},
    });
    const runner = agentCoreCodeRunner({ identifier: 'aws.codeinterpreter.v1', _sdk: sdk.module });
    const direct = await runner.start({ key: 'direct' });
    const result = await direct.execute({ code: 'run()' });
    const reads: string[] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (request) => {
          const tool = request.messages.find((m) => m.role === 'tool');
          if (tool === undefined) {
            return { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: 'run()' } }] };
          }
          reads.push(String(tool.content));
          return { content: 'done' };
        },
      }),
      model: 'mock',
      maxIterations: 3,
    })
      .tool(codeRunnerTool({ runner }))
      .build();
    const records: Record<string, unknown>[] = [];
    agent.on('agentfootprint.tools.code_run', (e) => records.push({ ...e.payload }));
    await agent.run({ message: 'go' });
    return { result, read: reads[0] ?? '', record: records[0] ?? {} };
  }

  it('a SERVICE ERROR without an exit code: ok false, serviceError, no exitCode — not a failed program', async () => {
    const { result, read, record } = await through([
      {
        result: {
          content: [{ type: 'text', text: 'The interpreter could not take the request.' }],
          isError: true,
        },
      },
    ]);
    expect(result).toEqual({
      ok: false,
      serviceError: true,
      stdout: 'The interpreter could not take the request.',
      stderr: '',
    });
    expect(read).toContain('[not confirmed: the code runner flagged an error for the run_code');
    expect(read).toContain('whether that code ran is not known');
    expect(read).not.toContain('[exit');
    expect(record).toMatchObject({ ok: false, serviceError: true });
    expect('exitCode' in record).toBe(false);
  });

  it('a SUCCESSFUL response without an exit code: ok true, and no exitCode is made up', async () => {
    const { result, read, record } = await through([
      { result: { content: [], structuredContent: { stdout: 'done\n' }, isError: false } },
    ]);
    expect(result).toEqual({ ok: true, stdout: 'done\n', stderr: '' });
    expect(read).toBe('done\n');
    expect(record).toMatchObject({ ok: true });
    expect('exitCode' in record).toBe(false);
    expect('serviceError' in record).toBe(false);
  });

  it('an explicit NONZERO exit after partial work: ok false, exitCode 7, the partial output kept', async () => {
    const { result, read, record } = await through([
      {
        result: {
          content: [],
          structuredContent: { stdout: 'wrote rows 1-500\n', stderr: 'MemoryError\n', exitCode: 7 },
          isError: true,
        },
      },
    ]);
    expect(result).toEqual({
      ok: false,
      exitCode: 7,
      stdout: 'wrote rows 1-500\n',
      stderr: 'MemoryError\n',
    });
    expect(read).toContain('wrote rows 1-500');
    expect(read).toContain('[exit 7] the code did not complete successfully');
    expect(read).not.toContain('not confirmed');
    expect(record).toMatchObject({ ok: false, exitCode: 7 });
    expect('serviceError' in record).toBe(false);
  });

  it('a clean exit 0 is kept in the record exactly as reported', async () => {
    const { record } = await through([
      {
        result: { content: [], structuredContent: { stdout: '1\n', exitCode: 0 }, isError: false },
      },
    ]);
    expect(record).toMatchObject({ ok: true, exitCode: 0 });
  });
});

describe('no exit status is ever written as one — the whole path, adapter to tool', () => {
  /** Run `code` through a real local child, `codeRunnerTool`, and read back
   *  what the model would read and what the record kept. */
  async function locally(
    code: string,
  ): Promise<{ read: string; record: Record<string, unknown> | undefined }> {
    const tool = codeRunnerTool({ runner: localCodeRunner(), language: 'javascript' });
    const read = await tool.execute({ code }, ctx);
    const record = codeRunsOf(tool)?.get('c1') as Record<string, unknown> | undefined;
    return { read, record };
  }

  it.skipIf(process.platform === 'win32')(
    'a program ended by SIGKILL reads "no exit status reported (terminated by SIGKILL)" — never [exit non-zero]',
    async () => {
      const { read, record } = await locally('process.kill(process.pid, "SIGKILL")');
      expect(read).toContain(
        '[no exit status reported (terminated by SIGKILL): the code of the run_code call',
      );
      expect(read).not.toContain('[exit');
      expect(record).toMatchObject({ ok: false, terminatedBy: 'SIGKILL' });
      expect('exitCode' in (record ?? {})).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'output past the buffer ceiling: the cut is stated, and so is the missing exit status',
    async () => {
      const { read, record } = await locally(
        'const chunk = "x".repeat(1 << 20); for (let i = 0; i < 40; i++) process.stdout.write(chunk);',
      );
      expect(read).toContain('[truncated:');
      expect(read).toContain('[no exit status reported (terminated by SIGKILL)');
      expect(read).not.toContain('[exit');
      expect(record).toMatchObject({ ok: false, terminatedBy: 'SIGKILL' });
      expect('exitCode' in (record ?? {})).toBe(false);
    },
  );

  it('a real exit is printed with ITS number, from the child through to the line', async () => {
    const { read, record } = await locally('process.exit(3)');
    expect(read).toContain('[exit 3] the code did not complete successfully');
    expect(record).toMatchObject({ ok: false, exitCode: 3 });
  });

  it('never contradicts an explicit field: exitCode 0 with no verdict is not "reported neither"', async () => {
    const zero = await codeRunnerTool({
      runner: runnerAnswering({ exitCode: 0, stdout: '', stderr: '' }),
    }).execute({ code: 'x' }, ctx);
    expect(zero).not.toContain('reported neither');
    expect(zero).not.toContain('[exit');
    const three = await codeRunnerTool({
      runner: runnerAnswering({ exitCode: 3, stdout: '', stderr: '' }),
    }).execute({ code: 'x' }, ctx);
    expect(three).toContain('[exit 3]');
    expect(three).not.toContain('reported neither');
  });
});

describe('a run the runtime lost after it started — the whole path, adapter to tool', () => {
  it.skipIf(process.platform === 'win32')(
    'the model reads that the code STARTED and its outcome is unknown — never "install the interpreter"',
    async () => {
      const tool = codeRunnerTool({
        runner: localCodeRunner({ _childProcess: { spawn: spawnErroringAfterStart('EIO') } }),
        language: 'javascript',
      });
      let err: unknown;
      try {
        await tool.execute({ code: 'console.log("ready"); setTimeout(() => {}, 5000);' }, ctx);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CodeSandboxError);
      expect((err as CodeSandboxError).reason).toBe('error-after-start');
      expect((err as Error).message).toContain(
        'the code started, then the runtime reported an error for its process (EIO)',
      );
      expect((err as Error).message).toContain('Its outcome is unknown');
      expect((err as Error).message).not.toMatch(/could not run|install/i);
    },
  );
});
