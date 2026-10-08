/**
 * What one event is served as, and the run wiring around it —
 * `src/redaction/served.ts` and `src/redaction/runRedaction.ts`, below the
 * agent.
 *
 * The end-to-end suites drive an agent; these pin the pieces' own contracts,
 * including the branches an agent run rarely reaches: the no-policy identity,
 * a policy that selects only by event NAME, the identity on an event's meta,
 * a payload whose walk throws, the derived fields (a parser's message that
 * quotes the draft), the write relay's order, and a scope no run made.
 */
import { describe, expect, it, vi } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import type { FlowChart, RedactionPolicy } from 'footprintjs';

import { derivedRows, eventServing, SERVED_PLACEHOLDER } from '../../src/redaction/served.js';
import {
  createRunRedaction,
  emitServed,
  policyInForce,
  runKeepsOut,
  setEventSource,
} from '../../src/redaction/runRedaction.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import type { EventMeta } from '../../src/events/types.js';

const serving = (policy: RedactionPolicy | undefined) =>
  eventServing(() => new RedactionRule(policy), (policy?.emitPatterns?.length ?? 0) > 0);

const META = { runId: 'run-1', runtimeStageId: 'call-llm#3' } as unknown as EventMeta;

describe('eventServing — one event, decided once', () => {
  it('no policy: the payload and the meta are handed back as they are', () => {
    const s = serving(undefined);
    const payload = { args: { ssn: '123' } };
    const meta = { ...META, principal: 'alice' } as EventMeta;
    expect(s.active()).toBe(false);
    expect(s.payload('agentfootprint.stream.tool_start', payload)).toBe(payload);
    expect(s.meta(meta)).toBe(meta);
  });

  it('a selected name at any depth of the payload; the original untouched', () => {
    const payload = { toolCallId: 'c1', args: { citizen: { ssn: '123', name: 'Ada' } } };
    const served = serving({ keys: ['ssn'] }).payload(
      'agentfootprint.stream.tool_start',
      payload,
    ) as {
      args: { citizen: Record<string, unknown> };
    };
    expect(served.args.citizen).toEqual({ ssn: SERVED_PLACEHOLDER, name: 'Ada' });
    expect(payload.args.citizen.ssn).toBe('123');
  });

  it('a policy that selects only by event NAME is active, and serves that event whole', () => {
    const s = serving({ emitPatterns: [/stream\.token$/] });
    expect(s.active()).toBe(true);
    expect(s.payload('agentfootprint.stream.token', { content: 'hi' })).toBe(SERVED_PLACEHOLDER);
    const other = { iteration: 1 };
    expect(s.payload('agentfootprint.stream.llm_start', other)).toEqual(other);
  });

  it("the meta's identity is served by name; its address never is", () => {
    const meta = { ...META, principal: 'alice', tenant: 'acme' } as EventMeta;
    const served = serving({ keys: ['principal'] }).meta(meta);
    expect(served.principal).toBe(SERVED_PLACEHOLDER);
    expect(served.tenant).toBe('acme');
    expect(served.runId).toBe('run-1');
    expect(served.runtimeStageId).toBe('call-llm#3');
    // Nothing selected in it, or no identity at all: the same object.
    expect(serving({ keys: ['ssn'] }).meta(meta)).toBe(meta);
    expect(serving({ keys: ['principal'] }).meta(META)).toBe(META);
  });

  it('a payload whose walk throws is served as the placeholder whole, never raw', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'ssn', {
      enumerable: true,
      get() {
        throw new Error('no reading me');
      },
    });
    const served = serving({ keys: ['ssn'] }).payload('agentfootprint.stream.tool_end', {
      result: hostile,
    });
    expect(served).toBe(SERVED_PLACEHOLDER);
  });

  it("a parser's message is kept out with the draft it can quote (words)", () => {
    const retry = {
      attempt: 1,
      stage: 'json-parse',
      error: 'Unexpected token \'d\', "draft SSN 123" is not valid JSON',
    };
    const kept = serving({ keys: ['rawOutput'] }).payload(
      'agentfootprint.agent.output_schema_retry',
      retry,
    ) as Record<string, unknown>;
    expect(kept.error).toBe(SERVED_PLACEHOLDER);
    expect(kept.stage).toBe('json-parse');
    expect(retry.error).toContain('draft'); // the payload itself is untouched
    // The draft not kept out: the message stays.
    const clear = serving({ keys: ['history'] }).payload(
      'agentfootprint.agent.output_schema_retry',
      retry,
    ) as Record<string, unknown>;
    expect(clear.error).toBe(retry.error);
    // An event with no derived field present is handed back as served.
    const bare = { attempt: 1 };
    expect(
      serving({ keys: ['rawOutput'] }).payload('agentfootprint.agent.output_schema_retry', bare),
    ).toEqual(bare);
  });
});

describe('words — content the library quotes under names of its own', () => {
  const issue = (path: string, value: string) => ({
    path,
    expected: 'pattern',
    got: 'string',
    value,
  });

  it('a validation issue quoting an argument: kept out with the arguments, or with its own name', () => {
    const payload = {
      toolName: 'lookup',
      issues: [issue('ssn', 'SSN-123'), issue('city', 'Paris')],
    };
    const byArgs = serving({ keys: ['args'] }).payload(
      'agentfootprint.validation.args_invalid',
      payload,
    ) as { issues: { value: string; path: string }[] };
    expect(byArgs.issues.map((i) => i.value)).toEqual([SERVED_PLACEHOLDER, SERVED_PLACEHOLDER]);
    // Selected by the app's own field name: only that argument's quote.
    const byName = serving({ patterns: [/ssn/i] }).payload(
      'agentfootprint.validation.args_invalid',
      payload,
    ) as { issues: { value: string; path: string }[] };
    expect(byName.issues.map((i) => i.value)).toEqual([SERVED_PLACEHOLDER, 'Paris']);
    expect(byName.issues.map((i) => i.path)).toEqual(['ssn', 'city']); // the structure stays
    // Nothing named: the very payload.
    expect(
      serving({ keys: ['history'] }).payload('agentfootprint.validation.args_invalid', payload),
    ).toEqual(payload);
  });

  it('a check-in evidence pack: the model’s words, the rendered arguments, the quoted context', () => {
    const payload = {
      toolName: 'refund',
      request: {
        tool: 'refund',
        intent: 'Refund Ada because she asked',
        evidence: {
          willDo: 'Refund 40 EUR to ada@example.org',
          read: [{ channel: 'task', summary: 'please refund me' }],
          drivers: [{ id: 'task-1', channel: 'task', text: 'please refund me', score: 1 }],
        },
      },
    };
    const served = serving({
      keys: ['llmLatestContent', 'args', 'history'],
    }).payload('agentfootprint.checkin.request', payload) as typeof payload;
    expect(served.request.intent).toBe(SERVED_PLACEHOLDER);
    expect(served.request.evidence.willDo).toBe(SERVED_PLACEHOLDER);
    expect(served.request.evidence.read[0]).toEqual({
      channel: 'task',
      summary: SERVED_PLACEHOLDER,
    });
    expect(served.request.evidence.drivers[0]?.text).toBe(SERVED_PLACEHOLDER);
    expect(served.request.evidence.drivers[0]?.score).toBe(1);
    expect(payload.request.intent).toContain('Ada'); // never edited in place
  });

  it('a check-in’s rendered arguments: kept out with any argument name the rule keeps out', () => {
    const pack = (args: Record<string, unknown>) => ({
      tool: 'close_account',
      args,
      evidence: { willDo: `Close the account. — with ${JSON.stringify(args)}` },
    });
    const byName = serving({ patterns: [/ssn/i] });
    // A top-level argument, and one nested inside another: both are names the text can quote.
    for (const args of [{ ssn: 'SSN-1', reason: 'x' }, { customer: { ssn: 'SSN-1' } }]) {
      const checkIn = byName.payload('agentfootprint.checkin.request', {
        toolName: 'close_account',
        toolCallId: 't1',
        iteration: 1,
        request: pack(args),
      }) as { request: { evidence: { willDo: string } } };
      expect(checkIn.request.evidence.willDo).toBe(SERVED_PLACEHOLDER);
      // The same pack, riding the pause it asks with.
      const pause = byName.payload('agentfootprint.pause.request', {
        reason: 'check-in',
        questionPayload: { toolCallId: 't1', toolName: 'close_account', checkIn: pack(args) },
      }) as { questionPayload: { checkIn: { evidence: { willDo: string } } } };
      expect(pause.questionPayload.checkIn.evidence.willDo).toBe(SERVED_PLACEHOLDER);
    }
    // No argument the rule names: the text stays, as it is.
    const plain = pack({ city: 'Paris' });
    expect(
      byName.payload('agentfootprint.checkin.request', {
        toolName: 'close_account',
        toolCallId: 't1',
        iteration: 1,
        request: plain,
      }),
    ).toMatchObject({ request: { evidence: { willDo: plain.evidence.willDo } } });
  });

  it('every selector footprintjs offers counts — a field selector and a dotted-path pattern too', () => {
    const args = { customer: { ssn: 'SSN-1', name: 'Ada' } };
    for (const policy of [
      { fields: { customer: ['ssn'] } },
      { patterns: [/customer\.ssn/] },
      { keys: ['ssn'] },
    ] as RedactionPolicy[]) {
      const s = serving(policy);
      // The check-in's rendered arguments…
      const checkIn = s.payload('agentfootprint.checkin.request', {
        toolName: 'close_account',
        toolCallId: 't1',
        iteration: 1,
        request: {
          tool: 'close_account',
          args,
          evidence: { willDo: `Close — with ${JSON.stringify(args)}` },
        },
      }) as { request: { evidence: { willDo: string } } };
      expect(checkIn.request.evidence.willDo).toBe(SERVED_PLACEHOLDER);
      // …and a validation issue quoting that argument by its path.
      const invalid = s.payload('agentfootprint.validation.args_invalid', {
        toolName: 'close_account',
        issues: [
          { path: 'customer.ssn', expected: 'pattern', got: 'string', value: 'SSN-1' },
          { path: 'customer.name', expected: 'pattern', got: 'string', value: 'Ada' },
        ],
      }) as { issues: { value: string }[] };
      expect(invalid.issues.map((i) => i.value)).toEqual([SERVED_PLACEHOLDER, 'Ada']);
    }
  });

  it('a route guard’s judged result and a matcher’s witness', () => {
    const payload = {
      iteration: 1,
      cursorMove: {
        by: 'route',
        witness: { text: 'my ssn is 123', keyword: 'ssn' },
        guard: {
          conditions: [
            { key: 'status', op: 'eq', value: 'ok', actualSummary: 'ok: Ada', passed: true },
          ],
        },
      },
    };
    const served = serving({ keys: ['result', 'userMessage'] }).payload(
      'agentfootprint.context.evaluated',
      payload,
    ) as typeof payload;
    expect(served.cursorMove.witness).toEqual({ text: SERVED_PLACEHOLDER, keyword: 'ssn' });
    expect(served.cursorMove.guard.conditions[0]?.actualSummary).toBe(SERVED_PLACEHOLDER);
    expect(served.cursorMove.guard.conditions[0]?.value).toBe('ok'); // the declared constant stays
  });
});

describe('words — every row, at every path it names', () => {
  /**
   * A payload holding `canary` at `path` (dotted, `name[]` for a list), with a
   * structural sibling at every level — and, for a row whose value names the
   * argument it quotes, that name beside it (an argument nothing selects).
   */
  const plant = (path: string, canary: string, namedBy?: string): Record<string, unknown> => {
    const segments = path.split('.');
    const build = (i: number): unknown => {
      if (i === segments.length) return canary;
      const segment = segments[i]!;
      const list = segment.endsWith('[]');
      const name = list ? segment.slice(0, -2) : segment;
      const child = build(i + 1);
      return {
        [name]: list ? [child] : child,
        keep: `structure-${i}`,
        ...(namedBy !== undefined && i === segments.length - 1 && { [namedBy]: 'unrelated.arg' }),
      };
    };
    return build(0) as Record<string, unknown>;
  };

  for (const row of derivedRows()) {
    for (const path of row.paths) {
      it(`${row.type} · ${path} — kept out with ${row.from[0]}, and only then`, () => {
        const canary = `CANARY-${path}`;
        const payload = plant(path, canary, row.namedBy);
        const served = serving({ keys: [row.from[0]!] }).payload(row.type, payload);
        expect(JSON.stringify(served)).not.toContain(canary);
        expect(JSON.stringify(served)).toContain(SERVED_PLACEHOLDER);
        // The structure beside it stays, at every level.
        for (let i = 0; i < path.split('.').length; i++) {
          expect(JSON.stringify(served)).toContain(`structure-${i}`);
        }
        // A policy that names none of its sources leaves the payload as it is.
        expect(serving({ keys: ['nothingThisNames'] }).payload(row.type, payload)).toEqual(payload);
        // A policy that selects only a FIELD of a source keeps the content out too:
        // derived prose may quote any part of what it came from.
        const field = serving({ fields: { [row.from[0]!]: ['anyField'] } }).payload(
          row.type,
          payload,
        );
        expect(JSON.stringify(field)).not.toContain(canary);
      });
    }
  }
});

describe('words — fail closed where the paths cannot vouch', () => {
  const issue = (path: unknown) => ({
    toolName: 'lookup',
    issues: [{ path, value: 'SECRET-QUOTE', expected: 'string' }],
  });
  const served = (policy: RedactionPolicy, type: string, payload: unknown) =>
    JSON.stringify(serving(policy).payload(type, payload));

  it('a quoted argument whose path is missing or not text is kept out', () => {
    for (const path of [undefined, 42, null]) {
      expect(
        served({ keys: ['ssn'] }, 'agentfootprint.validation.args_invalid', issue(path)),
      ).not.toContain('SECRET-QUOTE');
    }
    // A path the rule does not select keeps the quote: it names an argument nobody chose.
    expect(
      served({ keys: ['ssn'] }, 'agentfootprint.validation.args_invalid', issue('customer.name')),
    ).toContain('SECRET-QUOTE');
    expect(
      served({ keys: ['ssn'] }, 'agentfootprint.validation.args_invalid', issue('customer.ssn')),
    ).not.toContain('SECRET-QUOTE');
  });

  it('a list or record the path cannot walk into is served whole when its owner is kept out', () => {
    const type = 'agentfootprint.tools.coverage_declared';
    const odd = [
      { toolName: 'find', checked: new Set([{ what: 'SECRET-WORDS' }]) },
      { toolName: 'find', checked: [new Map([['what', 'SECRET-WORDS']])] },
      { toolName: 'find', checked: { what: 'SECRET-WORDS' } },
    ];
    for (const payload of odd) {
      const out = serving({ keys: ['args'] }).payload(type, payload) as { checked: unknown };
      expect(
        out.checked === SERVED_PLACEHOLDER ||
          JSON.stringify(out.checked) === `["${SERVED_PLACEHOLDER}"]`,
      ).toBe(true);
    }
  });

  it('a rendered-from object the path cannot walk into keeps the rendering out', () => {
    const payload = {
      request: { args: new Map([['ssn', '123']]), evidence: { willDo: 'lookup(ssn=123)' } },
    };
    const out = serving({ keys: ['ssn'] }).payload('agentfootprint.checkin.request', payload) as {
      request: { evidence: { willDo: unknown } };
    };
    expect(out.request.evidence.willDo).toBe(SERVED_PLACEHOLDER);
  });

  it('a payload that is not a record is served whole when its derived content is kept out', () => {
    const type = 'agentfootprint.stream.tool_progress';
    expect(serving({ keys: ['result'] }).payload(type, ['progress', 'SECRET'])).toBe(
      SERVED_PLACEHOLDER,
    );
    // …and as it is when nothing it derives from is kept out.
    const list = ['progress'];
    expect(serving({ keys: ['ssn'] }).payload(type, list)).toBe(list);
  });
});

/** A chart whose factory hands back a bare scope — the run wrapper is what is under test. */
function scopedRun(policy: RedactionPolicy | undefined) {
  const dispatcher = new EventDispatcher();
  const run = createRunRedaction({ policy, dispatcher, getRunContext: () => ({} as never) });
  const emitted: { name: string; payload: unknown }[] = [];
  const factory = run.scopeFactoryFor({
    scopeFactory: () => ({
      $emit: (name: string, payload?: unknown) => emitted.push({ name, payload }),
      $setValue: vi.fn(),
    }),
  } as unknown as FlowChart);
  const scopeFor = (runtimeStageId: string) =>
    factory(
      { runtimeStageId, getRedactionRule: () => undefined } as never,
      'stage',
      {},
      undefined as never,
    ) as {
      $emit(name: string, payload?: unknown): void;
      $setValue: ReturnType<typeof vi.fn>;
    };
  return { run, dispatcher, emitted, scopeFor };
}

describe('runRedaction — the run wiring', () => {
  it('a scope no run made emits as it always did, and reports no policy', () => {
    const emitted: unknown[] = [];
    const bare = { $emit: (_name: string, payload?: unknown) => emitted.push(payload) };
    const payload = { args: { ssn: '123' } };
    emitServed(bare, 'agentfootprint.stream.tool_start', payload);
    expect(emitted).toEqual([payload]);
    expect(policyInForce(bare)).toBeUndefined();
    expect(runKeepsOut(bare, 'ssn')).toBe(false);
  });

  it("a run's scope: the real payload to the real tier, the served one to $emit", () => {
    const { dispatcher, emitted, scopeFor } = scopedRun({ keys: ['ssn'] });
    const real: unknown[] = [];
    dispatcher.onRealEvent((event) => real.push(event.payload));
    const scope = scopeFor('tool-calls#4');
    emitServed(scope, 'agentfootprint.stream.tool_start', { args: { ssn: '123' } });
    expect(real).toEqual([{ args: { ssn: '123' } }]);
    expect(emitted[0]?.payload).toEqual({ args: { ssn: SERVED_PLACEHOLDER } });
    expect(policyInForce(scope)).toEqual({ keys: ['ssn'] });
    expect(runKeepsOut(scope, 'ssn')).toBe(true);
    expect(runKeepsOut(scope, 'history')).toBe(false);
  });

  it('the write relay hands each value back once, oldest first, per stage and key', () => {
    const { run, scopeFor } = scopedRun({ keys: ['messagesInjections'] });
    const slot = scopeFor('sf-messages/compose#7');
    const other = scopeFor('sf-messages/compose#9');
    setEventSource(slot, 'messagesInjections', ['first']);
    setEventSource(slot, 'messagesInjections', ['second']);
    setEventSource(other, 'messagesInjections', ['other stage']);
    expect(slot.$setValue).toHaveBeenCalledTimes(2); // it still writes, as $setValue does
    // `keptOut`: the policy selects the key itself, so what is derived from it keeps that verdict.
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toEqual({
      value: ['first'],
      keptOut: true,
    });
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toEqual({
      value: ['second'],
      keptOut: true,
    });
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toBeUndefined();
    expect(run.takeRealWrite('sf-messages/compose#9', 'messagesInjections')).toEqual({
      value: ['other stage'],
      keptOut: true,
    });
    // A key the policy does not select is relayed too (any policy relays), and says so.
    setEventSource(slot, 'slotCompositions', { slot: 'messages' });
    expect(run.takeRealWrite('sf-messages/compose#7', 'slotCompositions')).toEqual({
      value: { slot: 'messages' },
      keptOut: false,
    });
  });

  it('no policy: nothing is relayed — the served write IS the value', () => {
    const { run, scopeFor } = scopedRun(undefined);
    const slot = scopeFor('sf-messages/compose#7');
    setEventSource(slot, 'messagesInjections', ['x']);
    expect(slot.$setValue).toHaveBeenCalledWith('messagesInjections', ['x']);
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toBeUndefined();
  });
});
