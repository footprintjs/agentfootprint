/**
 * A window is owed ONCE — the period left out entirely, through real agents on
 * a scripted provider.
 *
 * Law: a tool whose period takes several forms (a look-back beside start/stop
 * bounds) needs ONE window. When a call leaves every form out, the form the
 * rules ASSUME whole is that window and the other forms' arguments are an
 * alternative not taken — never asked, never filed. When no form is assumed,
 * ONE form is asked (the first, by its own asks) — never every argument of
 * every form, which would ask for two windows the tool refuses.
 *
 * Test types:
 *   functional  — assumed look-back beside asked bounds: runs on the default, no pause, with and
 *                 without `.time()`; the assumed form wins wherever it is declared; no form
 *                 assumed: one form's ask, answered, runs that window alone;
 *   integration — inner dispatch (`ctx.tools`) owes the window once and names it once;
 *   byte identity — a ONE-form period and a plain ruled tool ask exactly as before (each
 *                 argument its own field), and their inner-dispatch refusal is the same sentence.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, isInputPause, type Tool } from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';
import type { ArgumentRow } from '../../../../src/core/agent/arguments/rows.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };

function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'one-window-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
      i += 1;
      return { content: reply.content, toolCalls: reply.toolCalls ?? [], usage: { input: 0, output: 0 } };
    },
  };
}

const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

const LA = 'America/Los_Angeles';
const NOW = '2026-09-30T17:00:00Z';
const BOUNDS = { start: '2026-09-29T08:45:00-07:00', stop: '2026-09-29T08:55:00-07:00' };

type Rule = { assume: string } | { ask: string };

const LOOKBACK = { kind: 'lookback', argument: 'window', signed: false, units: 'mhdw' } as const;
const BOUNDS_FORM = {
  kind: 'bounds',
  from: { argument: 'start', as: 'iso', edge: 'inclusive' },
  to: { argument: 'stop', as: 'iso', edge: 'exclusive' },
} as const;

/** A client-activity tool: `cluster`, and the period's forms in the order given. */
function activity(
  ran: Record<string, unknown>[],
  rules: { window?: Rule; start?: Rule; stop?: Rule },
  forms: readonly (typeof LOOKBACK | typeof BOUNDS_FORM)[],
): Tool {
  const properties: Record<string, unknown> = { cluster: { type: 'string' } };
  for (const name of Object.keys(rules)) properties[name] = { type: 'string' };
  return defineTool({
    name: 'client_activity',
    description: 'Client operations for one cluster over a look-back or a past window.',
    inputSchema: { type: 'object', properties, required: ['cluster'] },
    askOrAssume: rules as never,
    period: { forms: forms as never, direction: 'past' },
    execute: async (args) => {
      ran.push({ ...(args as Record<string, unknown>) });
      return { rows: [] };
    },
  });
}

const ASSUMED_LOOKBACK = {
  window: { assume: '1h' },
  start: { ask: 'From when?' },
  stop: { ask: 'Until when?' },
};
const ALL_ASKED = {
  window: { ask: 'How far back?' },
  start: { ask: 'From when?' },
  stop: { ask: 'Until when?' },
};

const argumentRows = (agent: Agent): ArgumentRow[] =>
  (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');
const rowFacts = (agent: Agent) =>
  argumentRows(agent).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return { argument: row.argument, source: row.source, asked: row.asked };
  });

async function runOnce(tool: Tool, args: object, time: boolean) {
  const b = Agent.create({
    provider: scripted([call('c1', 'client_activity', args), answer('done')]) as never,
    model: 'm',
  }).tool(tool);
  const agent = (time ? b.time({ zone: LA }) : b).build();
  const out = await agent.run({ message: 'what was slow?', ...(time && { time: { now: NOW } }) } as never);
  return { agent, out };
}

// ─── the period left out ─────────────────────────────────────────────

describe('the period left out entirely: ONE window is owed', () => {
  for (const time of [false, true]) {
    const under = time ? 'under .time() (no window in the turn)' : 'without .time()';
    it(`an assumed look-back beside asked bounds runs on the default, nothing asked — ${under}`, async () => {
      const ran: Record<string, unknown>[] = [];
      const { agent, out } = await runOnce(
        activity(ran, ASSUMED_LOOKBACK, [LOOKBACK, BOUNDS_FORM]),
        { cluster: 'c' },
        time,
      );
      expect(isInputPause(out)).toBe(false);
      expect(ran).toEqual([{ cluster: 'c', window: '1h' }]);
      // The untaken bounds are not on the record: they were never owed.
      expect(rowFacts(agent)).toEqual([{ argument: 'window', source: 'default', asked: undefined }]);
    });

    it(`the ASSUMED form is the window wherever it is declared — bounds first — ${under}`, async () => {
      const ran: Record<string, unknown>[] = [];
      const { out } = await runOnce(
        activity(ran, ASSUMED_LOOKBACK, [BOUNDS_FORM, LOOKBACK]),
        { cluster: 'c' },
        time,
      );
      expect(isInputPause(out)).toBe(false);
      expect(ran).toEqual([{ cluster: 'c', window: '1h' }]);
    });

    it(`no form assumed: ONE form is asked, by its own ask, and its answer runs alone — ${under}`, async () => {
      const ran: Record<string, unknown>[] = [];
      const { agent, out } = await runOnce(
        activity(ran, ALL_ASKED, [LOOKBACK, BOUNDS_FORM]),
        { cluster: 'c' },
        time,
      );
      if (!isInputPause(out)) throw new Error(`expected the ask, got ${JSON.stringify(out)}`);
      const fields = out.awaitingInput.fields as readonly { id: string; description?: string }[];
      expect(fields.map((f) => f.description)).toEqual(['How far back?']);
      expect(rowFacts(agent)).toEqual([{ argument: 'window', source: undefined, asked: 'missing' }]);
      const done = await agent.resume(out.checkpoint as never, {
        requestId: out.awaitingInput.requestId,
        values: { [fields[0]!.id]: '6h' },
      });
      expect(done).toBe('done');
      expect(ran).toEqual([{ cluster: 'c', window: '6h' }]);
    });
  }

  it('a window the model SENT is untouched by this law: bounds run as sent', async () => {
    const ran: Record<string, unknown>[] = [];
    const { out } = await runOnce(
      activity(ran, ASSUMED_LOOKBACK, [LOOKBACK, BOUNDS_FORM]),
      { cluster: 'c', ...BOUNDS },
      false,
    );
    expect(isInputPause(out)).toBe(false);
    expect(ran).toEqual([{ cluster: 'c', ...BOUNDS }]);
  });
});

// ─── byte identity: one form, and no period ──────────────────────────

describe('byte identity — a one-form period and a plain ruled tool ask as before', () => {
  it('a bounds-only period left out asks each bound, one field each', async () => {
    const ran: Record<string, unknown>[] = [];
    const { agent, out } = await runOnce(
      activity(ran, { start: { ask: 'From when?' }, stop: { ask: 'Until when?' } }, [BOUNDS_FORM]),
      { cluster: 'c' },
      false,
    );
    if (!isInputPause(out)) throw new Error('expected the ask');
    expect(out.awaitingInput.fields).toEqual([
      { id: 'f1', type: 'string', required: true, description: 'From when?' },
      { id: 'f2', type: 'string', required: true, description: 'Until when?' },
    ]);
    expect(rowFacts(agent)).toEqual([
      { argument: 'start', source: undefined, asked: 'missing' },
      { argument: 'stop', source: undefined, asked: 'missing' },
    ]);
  });

  it('a plain ruled tool (no period) asks its ruled argument', async () => {
    const tool = defineTool({
      name: 'client_activity',
      description: 'Client operations for one cluster.',
      inputSchema: { type: 'object', properties: { cluster: { type: 'string' }, node: { type: 'string' } } },
      askOrAssume: { node: { ask: 'Which node?' } },
      execute: async () => ({ rows: [] }),
    });
    const { agent, out } = await runOnce(tool, { cluster: 'c' }, false);
    if (!isInputPause(out)) throw new Error('expected the ask');
    expect(out.awaitingInput.fields).toEqual([
      { id: 'f1', type: 'string', required: true, description: 'Which node?' },
    ]);
    expect(rowFacts(agent)).toEqual([{ argument: 'node', source: undefined, asked: 'missing' }]);
  });
});

// ─── inner dispatch ──────────────────────────────────────────────────

describe('inner dispatch (ctx.tools) owes the window once, and names it once', () => {
  async function inner(target: Tool, attempts: readonly object[]) {
    const refused: string[] = [];
    const composer = defineTool({
      name: 'walk',
      description: 'calls client_activity through ctx.tools',
      execute: async (_args, ctx) => {
        for (const args of attempts) {
          try {
            await ctx.tools!.call('client_activity', args);
          } catch (error) {
            refused.push((error as Error).message);
          }
        }
        return 'walked';
      },
    });
    const agent = Agent.create({
      provider: scripted([call('c1', 'walk'), answer('done')]) as never,
      model: 'm',
    })
      .tool(target)
      .tool(composer)
      .build();
    await agent.run({ message: 'go' });
    return { refused, rows: argumentRows(agent) };
  }

  it('one form whole runs; no window, or half of one, is refused naming ONE window', async () => {
    const ran: Record<string, unknown>[] = [];
    const { refused, rows } = await inner(activity(ran, ASSUMED_LOOKBACK, [LOOKBACK, BOUNDS_FORM]), [
      { cluster: 'c', window: '6h' },
      { cluster: 'c', ...BOUNDS },
      { cluster: 'c' },
      { cluster: 'c', start: BOUNDS.start },
    ]);
    expect(ran).toEqual([
      { cluster: 'c', window: '6h' },
      { cluster: 'c', ...BOUNDS },
    ]);
    expect(refused).toHaveLength(2);
    for (const message of refused) {
      expect(message).toContain("leaves one window — 'window', or 'start' and 'stop' — out");
    }
    expect(rows).toEqual([]);
  });

  it('a one-form period keeps its sentence: each missing argument named', async () => {
    const ran: Record<string, unknown>[] = [];
    const { refused } = await inner(
      activity(ran, { start: { ask: 'From when?' }, stop: { ask: 'Until when?' } }, [BOUNDS_FORM]),
      [{ cluster: 'c' }],
    );
    expect(ran).toEqual([]);
    expect(refused[0]).toBe(
      "ctx.tools.call('client_activity'): that tool declares argument rules (askOrAssume) and the " +
        "call leaves 'start', 'stop' out — inner dispatch fills nothing and files no row, so " +
        'running it would run on a value nobody chose, off the record. Pass every ruled argument, ' +
        'or call the tool as a top-level tool, where the inputs layer applies its rules.',
    );
  });
});
