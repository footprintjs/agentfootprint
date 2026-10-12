/**
 * Execution-seam demonstrations, NOT production integration of claim binding.
 * The real public Agent executes and governs tools. Test-owned host code calls
 * the new internal receipt ports at execute/return, then supplies the actual
 * tool_end modelResult (or result when absent). No new Agent option, recorded
 * row, checkpoint field, model request or support badge is invented here.
 * JSON receipt replay is tested separately from Agent checkpoint restoration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  deny,
  describedResult,
  inMemoryArtifacts,
  isPaused,
  isPlacedToolResult,
  type AgentRunCheckpoint,
  type LLMProvider,
  type ToolMiddleware,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { Payloads } from '../../../src/events.js';
import {
  captureDispatch,
  captureReturnedEvidence,
  evidenceSnapshot,
  finalizeEvidence,
} from '../../../src/integrity/claim-binding/capture.js';
import { bindClaim } from '../../../src/integrity/claim-binding/bindEvidence.js';
import type {
  CapturedDispatch,
  ClaimBindingRule,
  ReturnedEvidence,
  ScopeDeclaration,
} from '../../../src/integrity/claim-binding/types.js';

type Mode = 'classic' | 'dynamic' | 'dynamic-grouped';
type Reply = {
  content?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
};
type Request = Parameters<LLMProvider['complete']>[0];
const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;
const SCOPE: ScopeDeclaration = {
  id: 'regional-count',
  version: '1',
  dimensions: [
    { name: 'region', argumentPath: ['region'] },
    { name: 'currency', argumentPath: ['currency'] },
  ],
};
const RULE: ClaimBindingRule = {
  id: 'count',
  version: '1',
  toolName: 'read_count',
  scopeDeclaration: SCOPE,
  fact: { entity: 'fleet', field: 'count' },
  coverage: () => 'complete',
};
const ACCESS = { completed: true, resultVisible: true, scopeVisible: true };
const call = (region = 'west', id = 'c1'): Reply => ({
  toolCalls: [{ id, name: 'read_count', args: { region } }],
});

function seam(
  options: {
    replies?: readonly Reply[];
    middleware?: readonly ToolMiddleware[];
    mode?: Mode;
    runId?: string;
    value?: unknown;
    resultCeiling?: number;
    maxToolResultChars?: number;
    maxInlineChars?: number;
  } = {},
) {
  const requests: { messages: Request['messages'] }[] = [];
  const executions: {
    args: Record<string, unknown>;
    dispatch: CapturedDispatch;
    returned: ReturnedEvidence;
  }[] = [];
  const ends: Payloads.ToolEndPayload[] = [];
  const starts: unknown[] = [];
  const replies = options.replies ?? [call(), { content: 'done' }];
  let next = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: (request) => {
      requests.push({
        messages: JSON.parse(JSON.stringify(request.messages)) as Request['messages'],
      });
      const reply = replies[next++];
      if (reply === undefined) throw new Error('Synthetic provider script exhausted.');
      return reply;
    },
  });
  const tool = defineTool({
    name: 'read_count',
    description: 'Read a synthetic regional count.',
    inputSchema: {
      type: 'object',
      required: ['region', 'currency'],
      properties: { region: { type: 'string' }, currency: { type: 'string' } },
    },
    askOrAssume: { currency: { assume: 'USD' } },
    ...(options.resultCeiling !== undefined && {
      resultCeiling: { maxChars: options.resultCeiling },
    }),
    execute: (args, context) => {
      const dispatch = captureDispatch(
        {
          namespace: 'boundary-fixture',
          runId: options.runId ?? 'run',
          ordinal: executions.length + 1,
        },
        { toolName: 'read_count', toolCallId: context.toolCallId, iteration: context.iteration },
        args,
        SCOPE,
      );
      const original = describedResult({
        facts: [{ entity: 'fleet', count: options.value ?? (args.region === 'west' ? 30 : 40) }],
        provenance: { measuredAt: '2026-10-01T00:00:00Z', source: 'synthetic regional inventory' },
        coverage: { checked: ['Synthetic regional fixture.'] },
      });
      executions.push({
        args: structuredClone(args),
        dispatch,
        returned: captureReturnedEvidence(dispatch, original),
      });
      return original;
    },
  });
  let builder = Agent.create({
    provider,
    model: 'mock',
    reactMode: options.mode ?? 'dynamic',
    maxIterations: 6,
    ...(options.maxToolResultChars !== undefined && {
      maxToolResultChars: options.maxToolResultChars,
    }),
    ...(options.maxInlineChars !== undefined && {
      artifacts: {
        store: inMemoryArtifacts(),
        placement: { maxInlineChars: options.maxInlineChars },
      },
    }),
  })
    .tool(tool)
    .inputsLayer();
  for (const middleware of options.middleware ?? []) builder = builder.toolMiddleware(middleware);
  const agent = builder.build();
  agent.on('agentfootprint.stream.tool_start', (event) =>
    starts.push(structuredClone(event.payload)),
  );
  agent.on('agentfootprint.stream.tool_end', (event) => ends.push(structuredClone(event.payload)));
  const resultAt = (index: number, access = ACCESS) => {
    const execution = executions[index];
    const end = ends[index];
    if (execution === undefined || end === undefined)
      throw new Error('Fixture did not execute and settle this occurrence.');
    // This synchronous fixture has one matching end per actual execution.
    // Do not promote this ordered test join into a runtime identity resolver.
    expect(end.toolCallId).toBe(execution.dispatch.toolCallId);
    const final = Object.hasOwn(end, 'modelResult') ? end.modelResult : end.result;
    return finalizeEvidence(execution.dispatch, execution.returned, final, access);
  };
  return { agent, executions, ends, starts, requests, resultAt };
}

const bound = (result: ReturnType<ReturnType<typeof seam>['resultAt']>, value = 30) =>
  bindClaim(
    { result: result.id, value, rule: RULE.id },
    evidenceSnapshot('boundary-fixture', [result.identity.runId], [result]),
    [RULE],
  );

afterEach(() => vi.useRealTimers());

describe('public-Agent seam: what executed, not what the model proposed', () => {
  it.each(MODES)(
    '%s captures defaults and final before-tool middleware arguments',
    async (mode) => {
      const fixture = seam({
        mode,
        middleware: [
          {
            name: 'regional-policy',
            onToolCall: (call) =>
              allow(
                { ...call.args, region: 'east', currency: 'EUR' },
                'Use the authorized regional source.',
              ),
          },
        ],
      });
      await fixture.agent.run({ message: 'Read the regional fixture.' });
      expect(fixture.executions.map((execution) => execution.args)).toEqual([
        { region: 'east', currency: 'EUR' },
      ]);
      const result = fixture.resultAt(0);
      expect(result.scope).toEqual(fixture.executions[0]?.args);
      expect(result.scope).not.toEqual({ region: 'west', currency: 'USD' });
      expect(result.facts?.[0]?.value).toBe(40);
      expect(bound(result, 40).kind).toBe('bound');
      expect(JSON.stringify(fixture.starts)).toContain('west');
      expect(
        fixture.requests
          .at(-1)
          ?.messages.some(
            (message) => message.role === 'tool' && String(message.content).includes('40'),
          ),
      ).toBe(true);
    },
  );

  it('captures the executed default but does not add a new Agent state or checkpoint field', async () => {
    const fixture = seam();
    await fixture.agent.run({ message: 'Read the regional fixture.' });
    expect(fixture.executions[0]?.args).toEqual({ region: 'west', currency: 'USD' });
    expect(bound(fixture.resultAt(0)).kind).toBe('bound');
    const checkpoint = fixture.agent.checkpoint();
    expect(checkpoint).not.toHaveProperty('claimEvidence');
    expect(checkpoint).not.toHaveProperty('evidenceSnapshot');
    expect(JSON.stringify(checkpoint)).not.toContain('claim-result/');
    expect(JSON.stringify(fixture.requests)).not.toContain('claim-result/');
  });

  it('approved middleware pause captures only the eventual execution on a fresh Agent', async () => {
    const first = seam({
      middleware: [
        {
          name: 'before-ask',
          onToolCall: (call) =>
            allow({ ...call.args, region: 'east' }, 'Select authorized region.'),
        },
        { name: 'approval', onToolCall: () => ask({ question: 'Read this source?' }) },
        {
          name: 'after-ask',
          onToolCall: (call) => allow({ ...call.args, currency: 'EUR' }, 'Approved currency.'),
        },
      ],
    });
    const paused = await first.agent.run({ message: 'Read the regional fixture.' });
    if (!isPaused(paused)) throw new Error('Expected the real middleware pause.');
    expect(first.executions).toEqual([]);
    const next = seam({
      replies: [{ content: 'done' }],
      middleware: [
        {
          name: 'before-ask',
          onToolCall: (call) =>
            allow({ ...call.args, region: 'east' }, 'Select authorized region.'),
        },
        { name: 'approval', onToolCall: () => ask({ question: 'Read this source?' }) },
        {
          name: 'after-ask',
          onToolCall: (call) => allow({ ...call.args, currency: 'EUR' }, 'Approved currency.'),
        },
      ],
    });
    await next.agent.resume(
      JSON.parse(JSON.stringify(paused.checkpoint)),
      checkInApproved({ by: 'synthetic reviewer' }),
    );
    expect(next.executions.map((execution) => execution.args)).toEqual([
      { region: 'east', currency: 'EUR' },
    ]);
    expect(bound(next.resultAt(0), 40).kind).toBe('bound');
  });

  it('after a check-in pause, scope captures converted dispatch bounds instead of saved look-back args', async () => {
    const now = '2026-10-09T15:40:00Z';
    const nowMs = Date.parse(now);
    const window = { from: '2026-10-09T14:40:00Z', to: now };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(nowMs + 5000);
    const declaration: ScopeDeclaration = {
      id: 'executed-bounds',
      version: '1',
      dimensions: [
        { name: 'from', argumentPath: ['start_time'] },
        { name: 'to', argumentPath: ['end_time'] },
      ],
    };
    let captured: CapturedDispatch | undefined;
    let returned: ReturnedEvidence | undefined;
    let executed: Record<string, unknown> | undefined;
    let end: Payloads.ToolEndPayload | undefined;
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [{ toolCalls: [{ id: 'clock-call', name: 'client_activity', args: {} }] }, 'done'],
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'client_activity',
          description: 'Synthetic period-bound tool.',
          checkIn: 'always',
          inputSchema: {
            type: 'object',
            properties: {
              window: { type: 'string' },
              start_time: { type: 'integer' },
              end_time: { type: 'integer' },
            },
          },
          askOrAssume: {
            window: { assume: '1h' },
            start_time: { ask: 'From when?' },
            end_time: { ask: 'Until when?' },
          },
          period: {
            forms: [
              { kind: 'lookback', argument: 'window', signed: false },
              {
                kind: 'bounds',
                from: { argument: 'start_time', as: 'epoch-ms' },
                to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
              },
            ],
          },
          execute: (args, context) => {
            executed = structuredClone(args);
            captured = captureDispatch(
              { namespace: 'boundary-fixture', runId: 'clock', ordinal: 1 },
              {
                toolName: 'client_activity',
                toolCallId: context.toolCallId,
                iteration: context.iteration,
              },
              args,
              declaration,
            );
            const original = describedResult({
              facts: [{ entity: 'fleet', count: 30 }],
              provenance: { measuredAt: now, source: 'synthetic clock fixture' },
              coverage: { checked: ['Fixture interval.'] },
              period: { queried: window, held: window },
            });
            returned = captureReturnedEvidence(captured, original);
            return original;
          },
        }),
      )
      .time({ zone: 'America/Los_Angeles' })
      .build();
    agent.on('agentfootprint.stream.tool_end', (event) => {
      end = structuredClone(event.payload);
    });
    const paused = await agent.run({ message: 'Read activity.', time: { now, window } });
    if (!isPaused(paused)) throw new Error('Expected check-in pause.');
    expect(captured).toBeUndefined();
    vi.setSystemTime(nowMs + 30 * 60000);
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'synthetic reviewer' }));
    expect(executed).toMatchObject({ start_time: Date.parse(window.from), end_time: nowMs });
    expect(executed).not.toHaveProperty('window');
    if (captured === undefined || returned === undefined || end === undefined)
      throw new Error('Expected one execution and settlement.');
    const result = finalizeEvidence(
      captured,
      returned,
      Object.hasOwn(end, 'modelResult') ? end.modelResult : end.result,
      ACCESS,
    );
    expect(result.scope).toEqual({ from: Date.parse(window.from), to: nowMs });
    expect(result.unavailable).toBeUndefined();
  });
});

describe('public-Agent seam: governed results, identity and replay', () => {
  it.each(['ceiling', 'cap', 'placement'] as const)(
    'the actual %s delivery boundary cannot bind the original semantic facts',
    async (boundary) => {
      const rawValue = `RAW-OVERSIZED-FACT-${'x'.repeat(5_000)}`;
      const fixture = seam({
        value: rawValue,
        ...(boundary === 'ceiling' && { resultCeiling: 1_000 }),
        ...(boundary === 'cap' && { maxToolResultChars: 1_000 }),
        ...(boundary === 'placement' && { maxInlineChars: 1_000 }),
      });
      const refused: unknown[] = [];
      const minted: unknown[] = [];
      fixture.agent.on('agentfootprint.tools.result_refused', (event) =>
        refused.push(event.payload),
      );
      fixture.agent.on('agentfootprint.artifacts.minted', (event) => minted.push(event.payload));
      await fixture.agent.run({ message: 'Read the oversized synthetic fixture.' });
      expect(fixture.executions).toHaveLength(1);
      expect(fixture.executions[0]?.returned.semantics).toBeDefined();
      expect(fixture.ends).toHaveLength(1);
      const end = fixture.ends[0]!;
      const delivered = Object.hasOwn(end, 'modelResult') ? end.modelResult : end.result;
      if (boundary === 'ceiling') {
        expect(String(delivered)).toContain('Result too large');
        expect(refused).toHaveLength(1);
        expect(minted).toHaveLength(0);
      } else if (boundary === 'cap') {
        expect(delivered).toMatchObject({ truncated: true });
        expect(refused).toHaveLength(0);
        expect(minted).toHaveLength(0);
      } else {
        expect(isPlacedToolResult(delivered)).toBe(true);
        expect(refused).toHaveLength(0);
        expect(minted).toHaveLength(1);
      }
      // Bind against the actual governed model channel, never the captured
      // original. Even true visibility flags cannot authorize a changed value.
      const result = fixture.resultAt(0);
      expect(result.unavailable).toBeDefined();
      expect(result).not.toHaveProperty('facts');
      expect(result).not.toHaveProperty('scope');
      expect(JSON.stringify(result)).not.toContain('RAW-OVERSIZED-FACT');
      expect(bound(result)).toEqual({ kind: 'unverified', reason: result.unavailable });
    },
  );

  for (const mode of MODES) {
    it(`${mode}: an after-tool rewrite cannot bind against the hidden original`, async () => {
      const fixture = seam({
        mode,
        value: 'RAW-VALUE-CANARY',
        middleware: [
          {
            name: 'scrub',
            onToolResult: () =>
              allow(
                { facts: [{ entity: 'fleet', count: 30 }] },
                'Only the authorized projection may be served.',
              ),
          },
        ],
      });
      await fixture.agent.run({ message: 'Read the regional fixture.' });
      expect(fixture.ends[0]).toHaveProperty('modelResult');
      const result = fixture.resultAt(0);
      expect(result.unavailable).toBe('unassociated-result');
      expect(JSON.stringify(result)).not.toContain('RAW-VALUE-CANARY');
      expect(JSON.stringify(fixture.requests)).not.toContain('RAW-VALUE-CANARY');
      expect(bound(result)).toEqual({ kind: 'unverified', reason: 'unassociated-result' });
    });
  }

  it('after-tool denial and explicit scope redaction remove evidence, not just displayed facts', async () => {
    const denied = seam({
      value: 'PRIVATE-ORIGINAL',
      middleware: [
        { name: 'deny-result', onToolResult: () => deny('This result is unavailable.') },
      ],
    });
    await denied.agent.run({ message: 'Read the regional fixture.' });
    const hidden = denied.resultAt(0, { ...ACCESS, resultVisible: false });
    expect(hidden.unavailable).toBe('withheld-evidence');
    expect(hidden).not.toHaveProperty('scope');
    expect(JSON.stringify(hidden)).not.toContain('PRIVATE-ORIGINAL');
    const visible = seam();
    await visible.agent.run({ message: 'Read the regional fixture.' });
    expect(visible.resultAt(0, { ...ACCESS, scopeVisible: false }).unavailable).toBe(
      'withheld-evidence',
    );
  });

  it('a denied proposal has no dispatch receipt and no invented completed evidence', async () => {
    const fixture = seam({
      middleware: [{ name: 'deny-call', onToolCall: () => deny('Do not execute this source.') }],
    });
    await fixture.agent.run({ message: 'Read the regional fixture.' });
    expect(fixture.executions).toEqual([]);
    expect(evidenceSnapshot('boundary-fixture', ['run'], [])).toMatchObject({ results: [] });
  });

  it('actual repeated provider IDs do not make the later result replace the earlier one', async () => {
    const fixture = seam({
      replies: [call('west', 'repeated'), call('east', 'repeated'), { content: 'done' }],
    });
    await fixture.agent.run({ message: 'Read west, then east.' });
    const first = fixture.resultAt(0);
    const second = fixture.resultAt(1);
    expect(first.toolCallId).toBe(second.toolCallId);
    expect(first.id).not.toBe(second.id);
    expect(first.facts?.[0]?.value).toBe(30);
    expect(second.facts?.[0]?.value).toBe(40);
    const snapshot = evidenceSnapshot('boundary-fixture', ['run'], [first, second]);
    const check = bindClaim({ result: first.id, value: 30, rule: RULE.id }, snapshot, [RULE]);
    expect(check.kind).toBe('bound');
    if (check.kind !== 'bound') throw new Error('Original receipt should remain available.');
    expect(check.evidence.value).toBe(30);
    expect(check.scope.region).toBe('west');
  });

  it('two actual calls in one batch receive distinct host reservations despite the same provider ID', async () => {
    const fixture = seam({
      replies: [
        {
          toolCalls: [
            { id: 'repeated', name: 'read_count', args: { region: 'west' } },
            { id: 'repeated', name: 'read_count', args: { region: 'east' } },
          ],
        },
        { content: 'done' },
      ],
    });
    await fixture.agent.run({ message: 'Read the two regions.' });
    expect(fixture.executions.map((execution) => execution.args.region)).toEqual(['west', 'east']);
    const results = [fixture.resultAt(0), fixture.resultAt(1)];
    expect(new Set(results.map((result) => result.id)).size).toBe(2);
    expect(new Set(results.map((result) => result.iteration)).size).toBe(1);
    expect(results.map((result) => result.facts?.[0]?.value)).toEqual([30, 40]);
  });

  it('a fresh resumed Agent can repeat provider ID and iteration without replacing the retained receipt', async () => {
    const first = seam();
    await first.agent.run({ message: 'Read west.' });
    const checkpoint = first.agent.checkpoint();
    if (checkpoint === undefined) throw new Error('Expected real checkpoint.');
    const second = seam({ runId: 'fresh-resume', replies: [call('east'), { content: 'done' }] });
    await second.agent.resumeOnError(JSON.parse(JSON.stringify(checkpoint)) as AgentRunCheckpoint);
    const old = first.resultAt(0);
    const current = second.resultAt(0);
    expect(old.toolCallId).toBe(current.toolCallId);
    expect(old.iteration).toBe(current.iteration);
    expect(old.id).not.toBe(current.id);
    const snapshot = evidenceSnapshot('boundary-fixture', ['run', 'fresh-resume'], [old, current]);
    const checked = bindClaim({ result: old.id, value: 30, rule: RULE.id }, snapshot, [RULE]);
    expect(checked.kind).toBe('bound');
    if (checked.kind !== 'bound') throw new Error('Original receipt remains attributable.');
    expect(checked.evidence.value).toBe(30);
    expect(current.facts?.[0]?.value).toBe(40);
  });

  it.each(['continueFrom', 'resumeOnError'] as const)(
    '%s restores native history without pretending it restores test-owned receipts',
    async (door) => {
      const first = seam();
      await first.agent.run({ message: 'Read the regional fixture.' });
      const checkpoint = first.agent.checkpoint();
      if (checkpoint === undefined) throw new Error('Expected public Agent checkpoint.');
      const stored = JSON.parse(JSON.stringify(checkpoint)) as AgentRunCheckpoint;
      const second = seam({
        replies: [{ content: 'continued without tool execution' }],
        runId: 'new-process',
      });
      if (door === 'continueFrom')
        await second.agent.run({ message: 'Continue.', continueFrom: stored });
      else await second.agent.resumeOnError(stored);
      expect(second.executions).toEqual([]);
      expect(
        second.requests[0]?.messages.some(
          (message) => message.role === 'tool' && String(message.content).includes('30'),
        ),
      ).toBe(true);
      const old = first.resultAt(0);
      expect(
        bindClaim(
          { result: old.id, value: 30, rule: RULE.id },
          evidenceSnapshot('boundary-fixture', ['new-process'], []),
          [RULE],
        ),
      ).toEqual({ kind: 'unverified', reason: 'missing-result' });
      // Explicit, separately retained verified receipt snapshot: a future adapter
      // must own this retention. Nothing is grafted onto the native checkpoint.
      const retained = JSON.parse(
        JSON.stringify(evidenceSnapshot('boundary-fixture', ['run', 'new-process'], [old])),
      );
      expect(bindClaim({ result: old.id, value: 30, rule: RULE.id }, retained, [RULE]).kind).toBe(
        'bound',
      );
      expect(stored).toEqual(checkpoint);
    },
  );
});
