/** Public-native baseline: a protocol omission is distinct from a missing human value.
 * The future option is structural: today's public builder ignores it, so the
 * central baseline reaches a real native pause rather than an unknown-API error.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  isPaused,
  type AgentfootprintEvent,
  type LLMRequest,
  type LLMResponse,
} from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';

const TOOL = 'read_synthetic_vm_disks';
const VM_LIST = 'list_synthetic_vms';
const VM = 'fixture-vm-declaration-a';
const QUESTION = `Read disks for VM ${VM}.`;
const CODE = 'source-declaration-required';
type Call = LLMResponse['toolCalls'][number];
type Args = Readonly<Record<string, unknown>>;
type SeenRequest = Pick<LLMRequest, 'messages' | 'tools' | 'systemPrompt'>;
// Public provider requests may contain live native views; these synthetic wire
// projections are JSON. Detach them at this boundary without cloning a Proxy.
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const call = (id: string, args: Args): Call => ({ id, name: TOOL, args });
const claim = (id: string, vm = VM): Call =>
  call(id, {
    vm,
    _findings: { basis: 'direct', from: [{ argument: 'vm', source: 'user', quote: QUESTION }] },
  });
const batch = (...toolCalls: Call[]): Partial<LLMResponse> => ({ content: '', toolCalls });
const payload = (event: AgentfootprintEvent) => event.payload as unknown as Record<string, unknown>;
const rowsOf = (agent: Agent) => agent.findings() as readonly Record<string, unknown>[];

function fixture(
  responses: readonly (string | Partial<LLMResponse>)[],
  options: {
    correction?: boolean;
    sourcesDoor?: 'inputs' | 'findings';
    badFirstResult?: boolean;
  } = {},
) {
  const requests: SeenRequest[] = [];
  const executions: { tool: string; args: Args }[] = [];
  const atRequest: number[] = [];
  const events: AgentfootprintEvent[] = [];
  const provider = mock({
    respond(request) {
      requests.push(
        jsonCopy({
          messages: request.messages,
          tools: request.tools,
          systemPrompt: request.systemPrompt,
        }),
      );
      atRequest.push(executions.length);
      return responses[requests.length - 1] ?? 'No further scripted proposal.';
    },
  });
  const disk = defineTool({
    name: TOOL,
    description: 'Read disks from the immutable synthetic VM fixture.',
    inputSchema: {
      type: 'object',
      properties: { vm: { type: 'string' }, limit: { type: 'integer' } },
      required: ['vm'],
    },
    askOrAssume: { vm: { ask: 'Which VM should I read?' } },
    argumentsFrom: [VM_LIST],
    resultColumns: { capacity_gb: 'number' },
    execute(args) {
      executions.push({ tool: TOOL, args: jsonCopy(args) });
      return [{ capacity_gb: options.badFirstResult && executions.length === 1 ? 'bad-type' : 0 }];
    },
  });
  const sibling = defineTool({
    name: 'write_synthetic_marker',
    description: 'Write a synthetic marker to detect premature sibling side effects.',
    execute(args) {
      executions.push({ tool: 'write_synthetic_marker', args: jsonCopy(args) });
      return 'marker written';
    },
  });
  const inventory = defineTool({
    name: VM_LIST,
    description: 'List the immutable synthetic VM fixture identities.',
    execute(args) {
      executions.push({ tool: VM_LIST, args: jsonCopy(args) });
      return [{ vm: VM }];
    },
  });
  const builder = Agent.create({
    answerLayer: false,
    provider,
    model: 'mock',
    maxIterations: 6,
    integrityPosture: 'dev',
    noticeEmptyLookups: true,
    checkColumnTypes: 'warn',
  })
    .tool(disk)
    .tool(sibling)
    .tool(inventory);
  // Structural variable avoids an excess-property TypeScript failure on the
  // unchanged baseline. No private hook or missing runtime import is used.
  const futureOptions = {
    ...(options.sourcesDoor !== 'findings' && { argumentSources: true }),
    ...(options.correction !== false && { declarationCorrection: 'once' as const }),
  };
  builder.inputsLayer(futureOptions);
  if (options.sourcesDoor === 'findings') builder.findings({ argumentSources: true });
  const agent = builder.build();
  agent.on('*', (event) => events.push(event));
  return { agent, requests, executions, atRequest, events };
}

function notices(request: SeenRequest | undefined, ids: readonly string[]) {
  return (request?.messages ?? []).filter(
    (message) => message.role === 'tool' && ids.includes(message.toolCallId ?? ''),
  );
}

function expectCorrectionNotice(
  agent: Agent,
  request: SeenRequest | undefined,
  ids: readonly string[],
) {
  const found = notices(request, ids);
  expect(found).toHaveLength(ids.length);
  for (const message of found) {
    expect(message).not.toHaveProperty('toolChars');
    expect(message).not.toHaveProperty('toolResultOrigin');
    const state = agent.getSnapshot()?.sharedState as {
      readonly history?: SeenRequest['messages'];
    };
    const committed = (state.history ?? []).find(
      (entry) => entry.role === 'tool' && entry.toolCallId === message.toolCallId,
    );
    expect(committed).toMatchObject({
      toolChars: 0,
      toolResultOrigin: 'not-entered',
      content: message.content,
    });
    expect(String(message.content)).toContain(CODE);
    expect(String(message.content)).not.toContain(VM);
  }
}

describe('failure-first: native source declaration correction is an explicit inputs opt-in', () => {
  it.each(['inputs', 'findings'] as const)(
    'corrects an omitted parent through the %s source door without asking twice',
    async (sourcesDoor) => {
      const f = fixture(
        [
          batch(call('omitted-parent', { vm: VM })),
          batch(claim('corrected-quote')),
          'Completed synthetic lookup.',
        ],
        { sourcesDoor },
      );
      try {
        const out = await f.agent.run({ message: QUESTION });
        expect(isPaused(out)).toBe(false); // Canonical baseline pauses here, with zero dispatch.
        expect(out).toBe('Completed synthetic lookup.');
        expect(f.requests).toHaveLength(3);
        expect(f.atRequest).toEqual([0, 0, 1]);
        expect(f.executions).toEqual([{ tool: TOOL, args: { vm: VM } }]);
        expectCorrectionNotice(f.agent, f.requests[1], ['omitted-parent']);
        const first = rowsOf(f.agent).find(
          (row) => row.kind === 'argument' && row.toolCallId === 'omitted-parent',
        );
        expect(first).toMatchObject({ claimed: 'none', correction: CODE });
        expect(first).not.toHaveProperty('asked');
        expect(first).not.toHaveProperty('source');
        expect(rowsOf(f.agent)).toContainEqual(
          expect.objectContaining({
            kind: 'argument',
            toolCallId: 'corrected-quote',
            source: 'said',
            claimed: 'user',
          }),
        );
        const served = f.requests[0]!.tools!.find((tool) => tool.name === TOOL)!
          .inputSchema as Record<string, unknown>;
        expect(served.required ?? []).toContain('_findings');
      } finally {
        await f.agent.shutdown();
      }
    },
  );

  it.each([
    { name: 'empty valid source list', args: { vm: VM, _findings: { basis: 'direct', from: [] } } },
    {
      name: 'another argument declared',
      args: {
        vm: VM,
        limit: 7,
        _findings: { basis: 'direct', from: [{ argument: 'limit', source: 'assumed' }] },
      },
    },
  ])('corrects $name as an omission without inventing the missing source', async ({ args }) => {
    const corrected = {
      ...claim('new-claim').args,
      ...(Object.hasOwn(args, 'limit') && { limit: 7 }),
    };
    const f = fixture([
      batch(call('missing-entry', args)),
      batch(call('new-claim', corrected)),
      'Done.',
    ]);
    try {
      expect(await f.agent.run({ message: QUESTION })).toBe('Done.');
      expect(f.atRequest).toEqual([0, 0, 1]);
      expectCorrectionNotice(f.agent, f.requests[1], ['missing-entry']);
      expect(f.executions).toEqual([
        { tool: TOOL, args: { vm: VM, ...(Object.hasOwn(args, 'limit') && { limit: 7 }) } },
      ]);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('withholds the whole proposed batch, including a side-effecting sibling, before a new corrected proposal', async () => {
    const work: Call = { id: 'held-sibling', name: 'write_synthetic_marker', args: {} };
    const f = fixture([
      batch(work, call('held-disks', { vm: VM })),
      batch({ ...work, id: 'new-sibling' }, claim('new-disks')),
      'Done.',
    ]);
    try {
      expect(await f.agent.run({ message: QUESTION })).toBe('Done.');
      expect(f.atRequest).toEqual([0, 0, 2]);
      expect(f.executions.map((entry) => entry.tool)).toEqual(['write_synthetic_marker', TOOL]);
      expectCorrectionNotice(f.agent, f.requests[1], ['held-sibling', 'held-disks']);
      const disposition = f.events.findLast(
        (event) => event.type === 'agentfootprint.integrity.disposition',
      );
      expect(disposition).toBeDefined();
      const rows = payload(disposition!).rows as Record<string, unknown>[];
      // One withheld declaring encounter plus the ordinary final no-tools response.
      for (const check of ['empty-lookup', 'column-type-mismatch', 'missing-column']) {
        expect(rows.find((row) => row.check === check && row.seam === 'write')).toMatchObject({
          checked: 1,
          findings: 0,
          notApplicable: 2,
          unreachable: 0,
        });
      }
    } finally {
      await f.agent.shutdown();
    }
  });

  it('spends one opportunity, then raises the genuine human ask on a repeated omission', async () => {
    const f = fixture([
      batch(call('omission-one', { vm: VM })),
      batch(call('omission-two', { vm: VM })),
      'Must not be reached.',
    ]);
    try {
      const out = await f.agent.run({ message: QUESTION });
      expect(isPaused(out)).toBe(true);
      expect(f.requests).toHaveLength(2);
      expect(f.executions).toEqual([]);
      expectCorrectionNotice(f.agent, f.requests[1], ['omission-one']);
      expect(rowsOf(f.agent).filter((row) => row.correction === CODE)).toHaveLength(1);
      expect(rowsOf(f.agent)).toContainEqual(
        expect.objectContaining({
          kind: 'argument',
          toolCallId: 'omission-two',
          claimed: 'none',
          asked: 'unverified',
        }),
      );
    } finally {
      await f.agent.shutdown();
    }
  });

  it('retains an earlier completed finding when a later batch needs source correction', async () => {
    const f = fixture(
      [
        batch(claim('completed-mismatch')),
        batch(call('later-omission', { vm: VM })),
        batch(claim('later-corrected')),
        'Done.',
      ],
      { badFirstResult: true },
    );
    try {
      expect(await f.agent.run({ message: QUESTION })).toBe('Done.');
      expect(f.atRequest).toEqual([0, 1, 1, 2]);
      expect(f.executions).toHaveLength(2);
      const disposition = f.events.findLast(
        (event) => event.type === 'agentfootprint.integrity.disposition',
      );
      expect(disposition).toBeDefined();
      const rows = payload(disposition!).rows as Record<string, unknown>[];
      expect(
        rows.find((row) => row.check === 'column-type-mismatch' && row.seam === 'write'),
      ).toMatchObject({ checked: 2, findings: 1, notApplicable: 2, unreachable: 0 });
      expect(
        f.events
          .filter((event) => event.type === 'agentfootprint.integrity.context_error')
          .some((event) => payload(event).kind === 'column-type-mismatch'),
      ).toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('cannot redeem its fixed framework notice as a tool-produced value', async () => {
    const f = fixture([
      batch(call('withheld-result', { vm: VM })),
      batch(
        call('notice-redemption', {
          vm: CODE,
          _findings: {
            basis: 'direct',
            from: [{ argument: 'vm', source: 'result', id: 'withheld-result' }],
          },
        }),
      ),
      'Must not be reached.',
    ]);
    try {
      const out = await f.agent.run({ message: QUESTION });
      expect(isPaused(out)).toBe(true);
      expect(f.requests).toHaveLength(2);
      expect(f.executions).toEqual([]);
      expectCorrectionNotice(f.agent, f.requests[1], ['withheld-result']);
      expect(rowsOf(f.agent)).toContainEqual(
        expect.objectContaining({
          kind: 'argument',
          toolCallId: 'notice-redemption',
          claimed: 'result',
          asked: 'unverified',
        }),
      );
      expect(
        rowsOf(f.agent).find(
          (row) => row.kind === 'argument' && row.toolCallId === 'notice-redemption',
        ),
      ).toHaveProperty('failed');
    } finally {
      await f.agent.shutdown();
    }
  });
});

describe('existing source checks and no-opt-in behavior remain controls', () => {
  it('prioritizes a genuinely missing human value without spending correction or running a sibling', async () => {
    const f = fixture([
      batch(call('present-untraced', { vm: VM }), call('missing-human-value', {})),
      'Must not be reached.',
    ]);
    try {
      expect(isPaused(await f.agent.run({ message: QUESTION }))).toBe(true);
      expect(f.requests).toHaveLength(1);
      expect(f.executions).toEqual([]);
      expect(rowsOf(f.agent).some((row) => Object.hasOwn(row, 'correction'))).toBe(false);
      expect(rowsOf(f.agent)).toContainEqual(
        expect.objectContaining({
          kind: 'argument',
          toolCallId: 'missing-human-value',
          asked: 'missing',
        }),
      );
    } finally {
      await f.agent.shutdown();
    }
  });

  it('preserves the existing immediate human pause when correction is not enabled', async () => {
    const f = fixture([batch(call('legacy-omission', { vm: VM })), 'Must not be reached.'], {
      correction: false,
    });
    try {
      expect(isPaused(await f.agent.run({ message: QUESTION }))).toBe(true);
      expect(f.requests).toHaveLength(1);
      expect(f.executions).toEqual([]);
      expect(rowsOf(f.agent)).toContainEqual(
        expect.objectContaining({
          kind: 'argument',
          toolCallId: 'legacy-omission',
          claimed: 'none',
          asked: 'unverified',
        }),
      );
      expect(rowsOf(f.agent).some((row) => Object.hasOwn(row, 'correction'))).toBe(false);
    } finally {
      await f.agent.shutdown();
    }
  });

  it.each([
    { name: 'missing human value', args: {} },
    {
      name: 'explicit assumed source',
      args: {
        vm: VM,
        _findings: { basis: 'direct', from: [{ argument: 'vm', source: 'assumed' }] },
      },
    },
    {
      name: 'false user quote',
      args: {
        vm: VM,
        _findings: {
          basis: 'direct',
          from: [
            {
              argument: 'vm',
              source: 'user',
              quote: 'A different sentence never supplied by the person.',
            },
          ],
        },
      },
    },
    {
      name: 'malformed source entry',
      args: {
        vm: VM,
        _findings: { basis: 'direct', from: [{ argument: 'vm', source: 'user', quote: 7 }] },
      },
    },
  ])('keeps $name on its existing human-ask path', async ({ args }) => {
    const f = fixture([batch(call('needs-person', args)), 'Must not be reached.']);
    try {
      expect(isPaused(await f.agent.run({ message: QUESTION }))).toBe(true);
      expect(f.requests).toHaveLength(1);
      expect(f.executions).toEqual([]);
      expect(rowsOf(f.agent)).toContainEqual(
        expect.objectContaining({
          kind: 'argument',
          toolCallId: 'needs-person',
          asked: Object.hasOwn(args, 'vm') ? 'unverified' : 'missing',
        }),
      );
      expect(rowsOf(f.agent).some((row) => Object.hasOwn(row, 'correction'))).toBe(false);
      if (
        args._findings &&
        typeof args._findings === 'object' &&
        JSON.stringify(args._findings).includes('"quote":7')
      )
        expect(
          rowsOf(f.agent).some((row) => typeof row.malformed === 'number' && row.malformed > 0),
        ).toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('keeps an already verified claim on the ordinary one-dispatch path without correction', async () => {
    const f = fixture([batch(claim('already-traced')), 'Done.']);
    try {
      expect(await f.agent.run({ message: QUESTION })).toBe('Done.');
      expect(f.atRequest).toEqual([0, 1]);
      expect(f.executions).toEqual([{ tool: TOOL, args: { vm: VM } }]);
      expect(rowsOf(f.agent).some((row) => Object.hasOwn(row, 'correction'))).toBe(false);
      const disposition = f.events.findLast(
        (event) => event.type === 'agentfootprint.integrity.disposition',
      );
      expect(disposition).toBeDefined();
      const rows = payload(disposition!).rows as Record<string, unknown>[];
      // Ordinary completion records its final no-declaring-tool response as NA.
      for (const check of ['empty-lookup', 'column-type-mismatch', 'missing-column'])
        expect(rows.find((row) => row.check === check && row.seam === 'write')).toMatchObject({
          checked: 1,
          findings: 0,
          notApplicable: 1,
          unreachable: 0,
        });
    } finally {
      await f.agent.shutdown();
    }
  });
});
