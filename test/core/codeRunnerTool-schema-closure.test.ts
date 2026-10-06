/** The code tool admits code and its declared artifact refs before opening a session. */
import { describe, expect, it, vi } from 'vitest';

import { Agent, codeRunnerTool, inMemoryArtifacts } from '../../src/index.js';
import type {
  CodeInput,
  CodeRunner,
  CodeSession,
  LLMToolSchema,
} from '../../src/adapters/types.js';
import type { ToolArgValidationMode } from '../../src/core/agent/toolArgsValidation.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { staticTokens } from '../../src/identity.js';
import { mock } from '../../src/providers.js';

const CODE = 'print("computed")';
const CALL_ID = 'code-schema-call';
const CANARY = 'extra-argument-private-value';
const DATA = [{ total: 42 }];

/** Only the runner port is simulated; artifact storage and ref redemption are real. */
function recordingRunner() {
  const staged: CodeInput[][] = [];
  const execute = vi.fn(async (_request: Parameters<CodeSession['execute']>[0]) => ({
    ok: true,
    stdout: 'computed',
    stderr: '',
  }));
  const stageInputs = vi.fn(async (inputs: readonly CodeInput[]) => {
    staged.push([...inputs]);
    return inputs.map((input) => ({
      name: input.name,
      path: `/recording-runner/${input.fileName ?? input.name}`,
      bytes: typeof input.data === 'string' ? input.data.length : input.data.byteLength,
    }));
  });
  const stop = vi.fn(async () => {});
  const session: CodeSession = { id: 'recording-session', execute, stageInputs, stop };
  const start = vi.fn(async (_request: Parameters<CodeRunner['start']>[0]) => session);
  const runner: CodeRunner = { id: 'recording-code-runner', start };
  return { runner, start, execute, stageInputs, staged, stop };
}

async function dispatch(options: {
  args: (ref: string) => Record<string, unknown>;
  wants?: Readonly<Record<string, string>>;
  name?: string;
  mode?: ToolArgValidationMode;
  findings?: boolean;
}) {
  const recording = recordingRunner();
  const store = inMemoryArtifacts();
  const identity = { conversationId: 'code-schema-conversation' };
  const artifact = await store.put(identity, {
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data: DATA,
    label: 'Rows for code schema test',
  });
  const args = options.args(artifact.meta.ref);
  const name = options.name ?? 'run_code';
  // Spy on the real in-process credential provider without replacing its behavior.
  const credentials = staticTokens({ interpreter: 'synthetic-code-schema-token' });
  const getCredential = vi.spyOn(credentials, 'getCredential');
  const tool = codeRunnerTool({
    runner: recording.runner,
    name,
    needs: { credential: 'interpreter' },
    ...(options.wants !== undefined && { wants: options.wants }),
  });
  const offered: LLMToolSchema[] = [];
  const results: string[] = [];
  const events: AgentfootprintEvent[] = [];
  const builder = Agent.create({
    provider: mock({
      respond: (request) => {
        const schema = request.tools?.find((entry) => entry.name === name);
        if (schema !== undefined) offered.push(schema);
        const result = request.messages.find((message) => message.role === 'tool');
        if (result !== undefined) {
          results.push(String(result.content));
          return { content: 'done' };
        }
        return { toolCalls: [{ id: CALL_ID, name, args }] };
      },
    }),
    model: 'mock',
    maxIterations: 3,
    artifacts: { store },
    credentials,
    ...(options.mode !== undefined && { toolArgValidation: options.mode }),
  }).tool(tool);
  if (options.findings) builder.findings();
  const agent = builder.build();
  agent.on('*', (event) => events.push(event));
  expect(await agent.run({ message: 'Compute the requested result', identity })).toBe('done');
  return { ...recording, tool, offered, results, events, getCredential, args };
}

describe('codeRunnerTool — closed owned schema', () => {
  it.each([
    { name: 'run_code', wants: undefined, properties: ['code'] },
    { name: 'compute_rows', wants: { rows: 'dataset/rows' }, properties: ['code', 'rows'] },
  ])('closes $name over exactly its generated properties', ({ name, wants, properties }) => {
    const { runner } = recordingRunner();
    const tool = codeRunnerTool({ runner, name, ...(wants !== undefined && { wants }) });
    expect(tool.schema.inputSchema?.additionalProperties).toBe(false);
    expect(Object.keys(tool.schema.inputSchema?.properties ?? {})).toEqual(properties);
    expect(tool.schema.inputSchema?.required).toEqual(['code']);
  });

  it.each(['unexpected', 'constructor', '__proto__'])(
    'refuses an extra %s before credentials, session acquisition, staging, or code',
    async (extra) => {
      const state = await dispatch({
        wants: { dataset: 'dataset/rows' },
        args: (ref) => ({ code: CODE, dataset: ref, [extra]: CANARY }),
      });
      expect(state.getCredential).not.toHaveBeenCalled();
      expect(state.start).not.toHaveBeenCalled();
      expect(state.stageInputs).not.toHaveBeenCalled();
      expect(state.execute).not.toHaveBeenCalled();
      expect(state.stop).not.toHaveBeenCalled();
      expect(state.results).toHaveLength(1);
      expect(state.results[0]).toContain("Invalid arguments for tool 'run_code'");
      expect(state.results[0]).toContain(`'${extra}': expected no additional properties`);
      expect(state.results[0]).not.toContain(CANARY);
      const invalid = state.events.filter(
        (event) => event.type === 'agentfootprint.validation.args_invalid',
      );
      expect(invalid).toMatchObject([
        {
          payload: {
            toolName: 'run_code',
            toolCallId: CALL_ID,
            enforced: true,
            issues: [{ path: extra, expected: 'no additional properties', got: 'string' }],
          },
        },
      ]);
      expect(JSON.stringify(invalid)).not.toContain(CANARY);
    },
  );

  it('executes code with no artifact inputs and closes the session', async () => {
    const state = await dispatch({ args: () => ({ code: CODE }) });
    expect(state.getCredential).toHaveBeenCalledOnce();
    expect(state.start).toHaveBeenCalledOnce();
    expect(state.execute).toHaveBeenCalledWith(expect.objectContaining({ code: CODE }));
    expect(state.stageInputs).not.toHaveBeenCalled();
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.results).toEqual(['computed']);
  });

  it.each([
    { provided: ['dataset', 'comparison'], name: 'run_code' },
    { provided: ['dataset'], name: 'compute_rows' },
    { provided: [], name: 'run_code' },
  ])(
    'accepts declared wants $provided on $name, leaving omissions optional',
    async ({ provided, name }) => {
      const state = await dispatch({
        name,
        wants: { dataset: 'dataset/rows', comparison: 'dataset/rows' },
        args: (ref) => ({ code: CODE, ...Object.fromEntries(provided.map((key) => [key, ref])) }),
      });
      expect(state.getCredential).toHaveBeenCalledOnce();
      expect(state.start).toHaveBeenCalledOnce();
      expect(state.execute).toHaveBeenCalledWith(expect.objectContaining({ code: CODE }));
      expect(state.stop).toHaveBeenCalledOnce();
      expect(state.staged.flat().map((input) => input.name)).toEqual(provided);
      for (const input of state.staged.flat()) {
        expect(input.mediaType).toBe('application/json');
        expect(input.fileName).toBe(`${input.name}.json`);
        expect(JSON.parse(input.data as string)).toEqual(DATA);
      }
      if (provided.length === 0) {
        expect(state.stageInputs).not.toHaveBeenCalled();
        expect(state.results[0]).toContain('no artifact inputs were passed');
      } else {
        expect(state.stageInputs).toHaveBeenCalledOnce();
        expect(state.results[0]).toContain(`staged for the ${name} call this result answers`);
      }
      expect(
        state.events.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
      ).toEqual([]);
    },
  );

  it.each(['enforce', 'warn', 'off'] as const)('preserves the %s validation mode', async (mode) => {
    const state = await dispatch({ mode, args: () => ({ code: CODE, unexpected: CANARY }) });
    const executions = mode === 'enforce' ? 0 : 1;
    expect(state.getCredential).toHaveBeenCalledTimes(executions);
    expect(state.start).toHaveBeenCalledTimes(executions);
    expect(state.execute).toHaveBeenCalledTimes(executions);
    const invalid = state.events.filter(
      (event) => event.type === 'agentfootprint.validation.args_invalid',
    );
    if (mode === 'off') {
      expect(invalid).toEqual([]);
    } else {
      expect(invalid).toMatchObject([{ payload: { enforced: mode === 'enforce' } }]);
    }
    if (mode !== 'enforce') expect(state.results).toEqual(['computed']);
  });

  it('accepts runtime-reserved findings beside code and a declared artifact ref', async () => {
    const state = await dispatch({
      wants: { dataset: 'dataset/rows' },
      findings: true,
      args: (ref) => ({
        code: CODE,
        dataset: ref,
        _findings: { basis: 'direct', expect: 'high' },
      }),
    });
    expect(state.execute).toHaveBeenCalledOnce();
    expect(state.staged.flat().map((input) => input.name)).toEqual(['dataset']);
    expect(
      state.events.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
    ).toEqual([]);
    expect(
      state.events.filter((event) => event.type === 'agentfootprint.findings.declared'),
    ).toMatchObject([
      { payload: { toolName: 'run_code', toolCallId: CALL_ID, basis: 'direct', expect: 'high' } },
    ]);
    expect(state.offered[0]?.inputSchema?.properties).toHaveProperty('_findings');
    expect(state.tool.schema.inputSchema?.properties).not.toHaveProperty('_findings');
    const start = state.events.find((event) => event.type === 'agentfootprint.stream.tool_start');
    expect(start?.payload).toHaveProperty('args');
    expect(start?.payload).toMatchObject({ args: { code: CODE } });
    expect((start?.payload as { args?: unknown }).args).not.toHaveProperty('_findings');
    expect(state.args).toHaveProperty('_findings');
  });

  it('still refuses unrelated extras when findings are enabled', async () => {
    const state = await dispatch({
      findings: true,
      args: () => ({ code: CODE, unexpected: CANARY, _findings: { basis: 'direct' } }),
    });
    expect(state.start).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.results[0]).toContain("'unexpected': expected no additional properties");
    expect(state.results[0]).not.toContain("'_findings': expected no additional properties");
  });
});
