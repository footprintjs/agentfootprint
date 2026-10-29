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

import { Agent, codeRunnerTool, codeRunsOf } from '../../src/index.js';
import { agentCoreCodeRunner } from '../../src/adapters/code/agentcore.js';
import { mock } from '../../src/llm-providers.js';
import { unconfiguredCredentialProvider } from '../../src/identity/types.js';
import type { CodeResult, CodeRunner } from '../../src/provider-contract/types.js';
import type { ToolExecutionContext } from '../../src/tools/tools.js';
import { AWS_COMMAND_PINS, fakeSdk } from '../adapters/aws/awsCommandPin.js';

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
