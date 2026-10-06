/**
 * Inner dispatch enforces the tool's declared argument schema before creating
 * an inner context, resolving credentials, or entering the handler. Existing
 * check-in, artifact, and argument-rule refusals keep their priority.
 */
import { describe, expect, it, vi } from 'vitest';

import { unconfiguredArtifacts } from '../../../src/artifacts/capability.js';
import { agentToolDispatch } from '../../../src/core/agent/toolDispatch.js';
import { defineTool, type Tool, type ToolExecutionContext } from '../../../src/core/tools.js';

const closedSchema = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    filters: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field: { type: 'string' } },
        required: ['field'],
        additionalProperties: false,
      },
    },
  },
  required: ['city'],
  additionalProperties: false,
};

function harness(
  kind: 'raw' | 'defined',
  inputSchema: Record<string, unknown> = closedSchema,
  declarations: Partial<Pick<Tool, 'checkIn' | 'wants' | 'askOrAssume'>> = {},
) {
  const result = { rows: [{ city: 'Reno' }] };
  const execute = vi.fn((_args: Record<string, unknown>, _ctx: ToolExecutionContext) => result);
  const needs = { credential: 'weather', scopes: ['read'], mode: 'machine' } as const;
  const tool: Tool =
    kind === 'defined'
      ? defineTool({ name: 'weather', description: 'Weather', inputSchema, needs, execute })
      : { schema: { name: 'weather', description: 'Weather', inputSchema }, needs, execute };
  const credential = { kind: 'test', toHeaders: () => ({}) };
  const getCredential = vi.fn(async () => ({ status: 'issued' as const, credential }));
  const base: ToolExecutionContext = {
    toolCallId: 'outer:inner:1',
    iteration: 3,
    runId: 'run-1',
    sessionId: 'session-1',
    identity: { tenant: 'tenant-1', principal: 'person-1', conversationId: 'conversation-1' },
    signal: new AbortController().signal,
    credentials: { id: 'test', getCredential },
    hasCredentials: true,
    artifacts: unconfiguredArtifacts(),
    hasArtifacts: false,
    progress: vi.fn(),
    onTeardown: vi.fn(),
    teardownScopes: ['run'],
  };
  const innerContext = vi.fn((_name: string, _seq: number) => base);
  const dispatch = agentToolDispatch({
    lookup: (name) => (name === 'weather' ? { ...tool, ...declarations } : undefined),
    innerContext,
  });
  return { dispatch, execute, getCredential, innerContext, result, base, credential };
}

const invalidCalls = [
  {
    label: 'an unknown argument',
    args: { city: 'Reno', surprise: 'private-value' },
    correction: "- 'surprise': expected no additional properties, got string",
  },
  {
    label: 'a wrong argument type',
    args: { city: 42 },
    correction: "- 'city': expected string, got number",
  },
  {
    label: 'a missing required argument',
    args: {},
    correction: "- 'city' is required but missing",
  },
  {
    label: 'a wrong type inside an array item',
    args: { city: 'Reno', filters: [{ field: 42 }] },
    correction: "- 'filters[0].field': expected string, got number",
  },
  {
    label: 'a missing required argument inside an array item',
    args: { city: 'Reno', filters: [{}] },
    correction: "- 'filters[0].field' is required but missing",
  },
  {
    label: 'an unknown argument inside a closed array item',
    args: { city: 'Reno', filters: [{ field: 'temperature', extra: 'private-value' }] },
    correction: "- 'filters[0].extra': expected no additional properties, got string",
  },
];

describe.each(['raw', 'defined'] as const)('inner argument validation — %s Tool', (kind) => {
  it.each(invalidCalls)(
    'refuses $label before any dispatch effects',
    async ({ args, correction }) => {
      const h = harness(kind);

      const error = await h.dispatch.call('weather', args).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("Invalid arguments for tool 'weather'");
      expect(message).toContain(correction);
      expect(message).toContain('not executed');
      expect(message).toContain('call it again');
      expect(message).not.toContain('private-value');
      expect(h.innerContext).not.toHaveBeenCalled();
      expect(h.getCredential).not.toHaveBeenCalled();
      expect(h.execute).not.toHaveBeenCalled();

      // Refusal consumes no call sequence number; the first accepted call is 1.
      await h.dispatch.call('weather', { city: 'Reno' });
      expect(h.innerContext).toHaveBeenCalledExactlyOnceWith('weather', 1);
      expect(h.execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    'preserves valid args, results, and context references with additionalProperties=%s',
    async (open) => {
      const h = harness(kind, { ...closedSchema, additionalProperties: open });
      const args = {
        city: 'Reno',
        filters: [{ field: 'temperature' }],
        ...(open && { extra: { arbitrary: true } }),
      };
      const signal = new AbortController().signal;

      expect(await h.dispatch.call('weather', args, { signal })).toBe(h.result);
      expect(h.execute).toHaveBeenCalledTimes(1);
      const [received, ctx] = h.execute.mock.calls[0];
      expect(received).toBe(args);
      expect(ctx).toEqual({ ...h.base, signal, credential: h.credential });
      expect(ctx.identity).toBe(h.base.identity);
      expect(ctx.credentials).toBe(h.base.credentials);
      expect(ctx.artifacts).toBe(h.base.artifacts);
      expect(ctx.progress).toBe(h.base.progress);
      expect(ctx.onTeardown).toBe(h.base.onTeardown);
      expect(ctx.teardownScopes).toBe(h.base.teardownScopes);
      expect(ctx.credential).toBe(h.credential);
      expect(ctx.signal).toBe(signal);
      expect(ctx.tools).toBeUndefined();
      expect(h.getCredential).toHaveBeenCalledExactlyOnceWith({
        service: 'weather',
        scopes: ['read'],
        mode: 'machine',
      });

      await h.dispatch.call('weather', args);
      expect(h.innerContext).toHaveBeenLastCalledWith('weather', 2);
      expect(h.execute.mock.calls[1][1].signal).toBe(h.base.signal);
    },
  );
});

describe('inner argument validation preserves existing refusal priority', () => {
  const askOrAssume = { city: { ask: 'Which city?' } } as const;

  it.each([
    {
      label: 'checkIn before wants, rules, and schema',
      declarations: { checkIn: 'always', wants: { city: 'city/name' }, askOrAssume },
      refusal: 'that tool declares a human check-in',
    },
    {
      label: 'wants before rules and schema',
      declarations: { wants: { city: 'city/name' }, askOrAssume },
      refusal: 'that tool declares artifact arguments (wants)',
    },
    {
      label: 'rules before schema',
      declarations: { askOrAssume },
      refusal: "leaves 'city' out — inner dispatch fills nothing",
    },
  ] as const)('$label', async ({ declarations, refusal }) => {
    const h = harness('raw', closedSchema, declarations);
    const error = await h.dispatch.call('weather', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(refusal);
    expect((error as Error).message).not.toContain('Invalid arguments');
    expect(h.innerContext).not.toHaveBeenCalled();
    expect(h.getCredential).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('validates schema once every ruled argument is supplied', async () => {
    const h = harness('raw', closedSchema, { askOrAssume });
    await expect(h.dispatch.call('weather', { city: 42 })).rejects.toThrow(
      "- 'city': expected string, got number",
    );
    expect(h.innerContext).not.toHaveBeenCalled();
    expect(h.getCredential).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();

    await expect(h.dispatch.call('weather', { city: 'Reno' })).resolves.toBe(h.result);
    expect(h.innerContext).toHaveBeenCalledExactlyOnceWith('weather', 1);
  });

  it('keeps the missing-tool refusal before any dispatch effects', async () => {
    const h = harness('raw');
    await expect(h.dispatch.call('missing', {})).rejects.toThrow(
      "ctx.tools.call('missing'): no tool of that name",
    );
    expect(h.innerContext).not.toHaveBeenCalled();
    expect(h.getCredential).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });
});
