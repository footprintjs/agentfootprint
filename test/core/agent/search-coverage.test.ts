/**
 * `Tool.search` through a real agent loop — the dispatch funnel composes each
 * call's coverage from the declaration and the arguments the call ran with.
 *
 * Pinned here, end to end: the committed row (`coverageDeclared`) is the
 * design's § 3.2 row with its result identity; the model reads the composed
 * absence; the events carry references, never a composed value; a remote
 * declaration (MCP-sourced, or a ToolProvider's) establishes nothing; a
 * host-filled identity filter composes by reference and its value is on no
 * event and no row; a credential-filled argument composes nothing; a model
 * value for a filled argument is still refused; `checked: 'declared'` from a
 * tool with no search is refused; a tool with no search composes nothing and
 * writes no new key.
 *
 * Sections: Integration · Security · Regression.
 */

import { describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';

import {
  Agent,
  absent,
  defineTool,
  fromCredential,
  fromIdentity,
  hostFilled,
  type EmitEvent,
  type Tool,
} from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { requestContext, requestCredentials } from '../../../src/doors/security.js';
import { staticTools } from '../../../src/tool-providers/index.js';
import type { ComposedCoverage } from '../../../src/semantics/coverage/composedCoverage.js';
import type { ToolSearch } from '../../../src/semantics/coverage/search/types.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

const TENANT = 'acme-tenant-91f';
const TOKEN = 'tok-5e0c4b9d2a77';

const SEARCH: ToolSearch = {
  source: { what: 'the incident store', said: ['the incident store'] },
  subject: { what: 'incidents', said: ['incident', 'incidents'] },
  fixed: [{ name: 'status', value: 'open', said: ['open'] }],
  arguments: [
    { name: 'service', role: 'population' },
    { name: 'severity', role: 'filter', whenOmitted: { any: true } },
    { name: 'window', role: 'period', whenOmitted: '2h' },
  ],
  complete: 'within-arguments',
  gaps: [{ what: 'incidents filed by email', why: 'they never enter the store', bears: 'source' }],
};

const SCHEMA = {
  type: 'object',
  properties: {
    service: { type: 'string' },
    severity: { type: 'string' },
    window: { type: 'string' },
  },
  required: ['service'],
} as const;

const listIncidents = (over: Partial<Parameters<typeof defineTool>[0]> = {}): Tool =>
  defineTool({
    name: 'list_incidents',
    description: 'Open incidents for one service',
    inputSchema: SCHEMA,
    period: { argument: 'window', spelling: 'lookback' },
    askOrAssume: { window: { assume: '2h' } },
    search: SEARCH,
    execute: (args) =>
      absent({
        what: `open incidents on ${String((args as { service: string }).service)}`,
        checked: 'declared',
      }),
    ...over,
  } as never);

interface Run {
  readonly rows: readonly ComposedCoverage[];
  readonly state: Record<string, unknown>;
  readonly events: readonly EmitEvent[];
  readonly toolTurns: readonly string[];
}

/** One loop: the model calls each `calls` entry in turn, then answers. */
async function run(
  build: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  calls: readonly { readonly name: string; readonly args: Record<string, unknown> }[],
  runOptions: { identity?: unknown; request?: unknown; credentials?: unknown } = {},
): Promise<Run> {
  const events: EmitEvent[] = [];
  let n = 0;
  let last: LLMRequest | undefined;
  const agent = build(
    Agent.create({
      provider: mock({
        respond: (req) => {
          last = req;
          const call = calls[n];
          n += 1;
          return call === undefined
            ? { content: 'done' }
            : { toolCalls: [{ id: `c${n}`, name: call.name, args: call.args }] };
        },
      }),
      model: 'mock',
      maxIterations: calls.length + 2,
      ...(runOptions.credentials !== undefined && { credentials: runOptions.credentials as never }),
    }),
  )
    .watch({ id: 'keep-all', onEmit: (e: EmitEvent) => void events.push(e) })
    .build();
  await agent.run(
    {
      message: 'any open incidents?',
      ...(runOptions.identity !== undefined && { identity: runOptions.identity as never }),
    },
    runOptions.request !== undefined ? { request: runOptions.request as never } : undefined,
  );
  const state = (agent.getLastSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
  const toolTurns = (last?.messages ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
  return {
    rows: (state.coverageDeclared ?? []) as readonly ComposedCoverage[],
    state,
    events,
    toolTurns,
  };
}

const absentEvents = (r: Run) =>
  r.events.filter((e) => e.name === 'agentfootprint.tools.absent').map((e) => e.payload as never);

describe('integration — the committed row, the served absence, the events', () => {
  it('composes the § 3.2 row at a library-minted address', async () => {
    const r = await run(
      (b) => b.tool(listIncidents()),
      [{ name: 'list_incidents', args: { service: 'payments' } }],
    );
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0] as ComposedCoverage;
    expect(row).toMatchObject({
      kind: 'absence',
      toolName: 'list_incidents',
      toolCallId: 'c1',
      composed: 'local',
      lookedFor: 'open incidents on payments',
      complete: true,
    });
    expect(row.checked.find((i) => i.facet === 'subject')).toEqual({
      what: 'incidents',
      facet: 'subject',
      from: 'tool',
      said: ['incident', 'incidents'],
    });
    expect(row.resultId).toMatch(/^claim-result\/[^/]+\/[^/]+\/1$/);
    // Never the provider's call id: no segment of the address is `c1`.
    expect(row.resultId.split('/')).not.toContain('c1');
    expect(row.checked.map((i) => [i.what, i.from])).toEqual([
      ['the incident store', 'tool'],
      ['incidents', 'tool'],
      ['status: open', 'fixed'],
      ['service: payments', 'call'],
      ['severity: any', 'default'],
      ['window: 2h', 'call'],
    ]);
    expect(row.gaps).toEqual([
      {
        kind: 'scope',
        what: 'incidents filed by email',
        why: 'they never enter the store',
        bears: 'source',
      },
    ]);
  });

  it('the model reads the composed absence — typed items, no complete, no said words', async () => {
    const r = await run(
      (b) => b.tool(listIncidents()),
      [{ name: 'list_incidents', args: { service: 'payments' } }],
    );
    // The tool turn is the served JSON; the inputs layer may append its own
    // line after it (the assumed window), so the JSON is read up to there.
    const turn = r.toolTurns[0] ?? '{}';
    const served = JSON.parse(turn.slice(0, turn.lastIndexOf('}') + 1)) as Record<string, unknown>;
    expect(served.af_absent).toBe(true);
    expect('complete' in served).toBe(false);
    expect(JSON.stringify(served.checked)).toContain('"facet":"population"');
    expect(JSON.stringify(served)).not.toContain('"said"');
    expect(JSON.stringify(served)).not.toContain('"quote"');
  });

  it('the event carries references and constants, never a composed value', async () => {
    const r = await run(
      (b) => b.tool(listIncidents()),
      [{ name: 'list_incidents', args: { service: 'pay-77ab', severity: 'sev1-9c' } }],
    );
    const [event] = absentEvents(r) as Record<string, unknown>[];
    expect(event?.checked).toEqual([
      { what: 'the incident store' },
      { what: 'incidents' },
      { what: 'status: open' },
    ]);
    const { lookedFor, ...rest } = event ?? {};
    expect(lookedFor).toBe('open incidents on pay-77ab'); // unarmed: today's bytes
    const bytes = JSON.stringify(rest);
    expect(bytes).not.toContain('pay-77ab');
    expect(bytes).not.toContain('sev1-9c');
    expect((rest.composition as { resultId: string }).resultId).toBe(r.rows[0]?.resultId);
  });

  it('two calls in one turn: two addresses, one spelling, each its own dispatch span', async () => {
    const r = await run(
      (b) => b.tool(listIncidents()),
      [
        { name: 'list_incidents', args: { service: 'a', window: '2h' } },
        { name: 'list_incidents', args: { service: 'b', window: '2h' } },
      ],
    );
    const [first, second] = r.rows;
    expect(first?.resultId).not.toBe(second?.resultId);
    expect(second?.resultId).toMatch(/\/2$/);
    const windowOf = (row?: ComposedCoverage) => row?.checked.find((i) => i.facet === 'period');
    // The checker keys a relative window by its SPELLING within a run leg; the
    // span is when each call actually ran.
    expect(windowOf(first)?.value).toBe('2h');
    expect(windowOf(second)?.value).toBe('2h');
    const end = (row?: ComposedCoverage) => Date.parse(windowOf(row)?.span?.to ?? '');
    expect(end(second)).toBeGreaterThanOrEqual(end(first));
  });
});

describe('integration — remote declarations establish nothing', () => {
  it('a declaration that arrived over MCP composes remote, never complete', async () => {
    const remote = { ...listIncidents(), source: 'ops-mcp' } as Tool;
    const r = await run(
      (b) => b.tool(remote),
      [{ name: 'list_incidents', args: { service: 'payments' } }],
    );
    expect(r.rows[0]).toMatchObject({ composed: 'remote', complete: false });
  });

  it('a ToolProvider’s tool composes remote', async () => {
    // No argument rules: a ruled tool only a provider serves needs the inputs layer.
    const unruled = listIncidents({ askOrAssume: undefined, period: undefined } as never);
    const r = await run(
      (b) => b.toolProvider(staticTools([unruled])),
      [{ name: 'list_incidents', args: { service: 'payments' } }],
    );
    expect(r.rows[0]).toMatchObject({ composed: 'remote', complete: false });
  });
});

describe('security — host-filled arguments', () => {
  const tenanted = () =>
    hostFilled(
      listIncidents({
        inputSchema: {
          ...SCHEMA,
          properties: {
            ...SCHEMA.properties,
            tenantId: { type: 'string' },
            token: { type: 'string' },
          },
        },
        search: {
          ...SEARCH,
          arguments: [
            ...SEARCH.arguments,
            { name: 'tenantId', role: 'filter' },
            { name: 'token', role: 'inert' },
          ],
        },
      }),
      { tenantId: fromIdentity('tenant'), token: fromCredential({ service: 'store' }) },
    );
  const opts = {
    identity: { tenant: TENANT, principal: 'p1', conversationId: 'conv1' },
    credentials: requestCredentials({ services: { store: 'storeToken' } }),
    request: requestContext({ secrets: { storeToken: TOKEN } }),
  };

  it('an identity-filled filter composes by reference; a credential composes nothing', async () => {
    const r = await run(
      (b) => b.tool(tenanted()),
      [{ name: 'list_incidents', args: { service: 'payments' } }],
      opts,
    );
    const row = r.rows[0] as ComposedCoverage;
    expect(row.checked.find((i) => i.argument === 'tenantId')).toEqual({
      what: "tenantId: the caller's tenant",
      facet: 'filter',
      argument: 'tenantId',
      value: { identity: 'tenant' },
      from: 'host',
    });
    expect(row.checked.some((i) => i.argument === 'token')).toBe(false);
    expect(row.gaps.some((g) => g.argument === 'token' || g.argument === 'tenantId')).toBe(false);
  });

  it('the tenant value and the token are on no event and no row', async () => {
    const r = await run(
      (b) => b.tool(tenanted()),
      [{ name: 'list_incidents', args: { service: 'payments' } }],
      opts,
    );
    const bytes = JSON.stringify({ events: r.events.map((e) => e.payload), rows: r.rows });
    expect(bytes).not.toContain(TENANT);
    expect(bytes).not.toContain(TOKEN);
  });

  it('a model-sent value for a filled argument is still refused, and nothing composes', async () => {
    const r = await run(
      (b) => b.tool(tenanted()),
      [{ name: 'list_incidents', args: { service: 'payments', tenantId: 'other-tenant' } }],
      opts,
    );
    expect(r.toolTurns[0]).toMatch(/'tenantId' is filled by the host/);
    expect(r.rows).toEqual([]);
  });
});

describe('contract — the literal needs a declaration', () => {
  it("checked: 'declared' from a tool with no search is the call's error, naming the fix", async () => {
    const bare = defineTool({
      name: 'list_incidents',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: () => absent({ what: 'x', checked: 'declared' }),
    });
    const r = await run((b) => b.tool(bare), [{ name: 'list_incidents', args: {} }]);
    expect(r.toolTurns[0]).toMatch(/declares no `search`/);
    expect(r.rows).toEqual([]);
  });

  it('a hand-written checked list beside a search is filed as written and composes nothing', async () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const handWritten = listIncidents({
        name: 'list_incidents_hand',
        execute: () => absent({ what: 'x', checked: ['the incident store'] }),
      } as never);
      const r = await run(
        (b) => b.tool(handWritten),
        [{ name: 'list_incidents_hand', args: { service: 'p' } }],
      );
      expect(r.rows).toHaveLength(1);
      expect((r.rows[0] as Partial<ComposedCoverage>).composed).toBeUndefined();
      expect(warn.mock.calls.some((c) => /checked-beside-declared/.test(String(c[0])))).toBe(true);
    } finally {
      warn.mockRestore();
      disableDevMode();
    }
  });
});

describe('regression — a tool with no search composes nothing new', () => {
  it('no resultIdentities key, a row with no composed fields', async () => {
    const plain = defineTool({
      name: 'list_incidents',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      execute: () => absent({ what: 'x', checked: ['the incident store'] }),
    });
    const r = await run((b) => b.tool(plain), [{ name: 'list_incidents', args: {} }]);
    expect('resultIdentities' in r.state).toBe(false);
    expect(Object.keys(r.rows[0] ?? {}).sort()).toEqual(
      [
        'cannotCover',
        'checked',
        'iteration',
        'kind',
        'lookedFor',
        'notChecked',
        'toolCallId',
        'toolName',
      ].sort(),
    );
    const [event] = absentEvents(r) as Record<string, unknown>[];
    expect(event !== undefined && 'composition' in event).toBe(false);
  });
});

describe('integration — a relative window is the span at DISPATCH, not at the turn’s start', () => {
  it('a call resumed five hours after its pause composes the span it ran with', async () => {
    const { checkInApproved, isPaused } = await import('../../../src/index.js');
    const { pausedRequest } = await import('../../helpers/pausedRequest.js');
    const T0 = Date.parse('2026-10-22T08:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0);
      let n = 0;
      const agent = Agent.create({
        provider: mock({
          respond: () => {
            n += 1;
            return n === 1
              ? {
                  toolCalls: [
                    { id: 'c1', name: 'list_incidents', args: { service: 'p', window: '2h' } },
                  ],
                }
              : { content: 'done' };
          },
        }),
        model: 'mock',
        maxIterations: 3,
      })
        .tool(listIncidents({ checkIn: 'always' } as never))
        .build();
      const paused = await agent.run({ message: 'any incidents?' });
      expect(isPaused(paused)).toBe(true);
      vi.setSystemTime(T0 + 5 * 3_600_000); // the person answers five hours later
      await agent.resume(
        (paused as { checkpoint: never }).checkpoint,
        checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
      );
      const rows = (
        agent.getLastSnapshot()?.sharedState as { coverageDeclared?: ComposedCoverage[] }
      ).coverageDeclared;
      const window = rows?.[0]?.checked.find((i) => i.facet === 'period');
      expect(window?.value).toBe('2h'); // the spelling stays beside the span
      // The dispatch instant (13:00), not the turn's start (08:00).
      expect(window?.span?.to).toBe('2026-10-22T13:00:00.001Z');
      expect(Date.parse(window?.span?.from ?? '')).toBe(Date.parse('2026-10-22T11:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });
});
