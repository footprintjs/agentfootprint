/**
 * toolContractCheckup — diff an agent's tool schemas against a server catalog.
 *
 * Convention-3 tiers: unit (each divergence code), functional (aligned → ok/empty),
 * integration (a Neo-shaped catalog: aligned + one drift), property (identical sides
 * never diverge), security (malformed entries don't throw).
 */
import { describe, it, expect } from 'vitest';
import { defineTool, toolContractCheckup, type ServerToolEntry } from '../../src/index.js';

const srv = (name: string, required: string[] = [], props: string[] = []): ServerToolEntry => ({
  name,
  inputSchema: {
    required,
    properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])),
  },
});

const tool = (name: string, required: string[] = [], props: string[] = []) =>
  defineTool({
    name,
    description: name,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])),
      required,
    },
    execute: () => 'x',
  });

describe('toolContractCheckup — unit (one divergence at a time)', () => {
  it('fully aligned → ok, no problems', () => {
    const agent = [tool('get_x', ['id'], ['id', 'window'])];
    const server = [srv('get_x', ['id'], ['id', 'window'])];
    expect(toolContractCheckup(agent, server)).toEqual({ ok: true, problems: [] });
  });

  it('required-divergence (ERROR): server requires an arg the agent marks optional', () => {
    const agent = [tool('get_x', [], ['id'])]; // id present but NOT required
    const server = [srv('get_x', ['id'], ['id'])]; // server requires id
    const r = toolContractCheckup(agent, server);
    expect(r.ok).toBe(false);
    expect(r.problems[0].code).toBe('required-divergence');
    expect(r.problems[0].message).toContain('marks it OPTIONAL');
  });

  it('required-divergence (ERROR): server requires an arg the agent omits entirely', () => {
    const r = toolContractCheckup([tool('get_x', [], [])], [srv('get_x', ['id'], ['id'])]);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.code)).toContain('required-divergence');
    expect(r.problems.find((p) => p.code === 'required-divergence')!.message).toContain('omits it');
  });

  it('optional-drift (WARNING): server accepts an optional arg the agent omits', () => {
    const r = toolContractCheckup(
      [tool('get_x', [], ['id'])],
      [srv('get_x', [], ['id', 'window'])],
    );
    expect(r.ok).toBe(true); // warning, not error
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].code).toBe('optional-drift');
    expect(r.problems[0].message).toContain('window');
  });

  it('arg-divergence (WARNING): agent declares an arg the server does not have', () => {
    const r = toolContractCheckup([tool('get_x', [], ['id', 'host'])], [srv('get_x', [], ['id'])]);
    expect(r.problems.map((p) => p.code)).toEqual(['arg-divergence']);
    expect(r.problems[0].message).toContain('host');
  });

  it('missing-on-server (ERROR) + dead-endpoint (WARNING)', () => {
    const r = toolContractCheckup([tool('only_agent', [], [])], [srv('only_server', [], [])]);
    const codes = r.problems.map((p) => p.code).sort();
    expect(codes).toEqual(['dead-endpoint', 'missing-on-server']);
    expect(r.ok).toBe(false); // missing-on-server is an error
  });
});

describe('toolContractCheckup — integration (Neo-shaped catalog)', () => {
  it("aligned schemas (server mirrors the agent) → ok — proves there's no drift", () => {
    const agent = [
      tool('influx_get_io_profile', ['initiator_id'], ['initiator_id', 'switch_name']),
      tool('pmax_get_array_perf', ['array_id'], ['array_id', 'window']),
      tool('volume_lookup_by_wwn', ['wwn'], ['wwn']),
    ];
    const server: ServerToolEntry[] = [
      srv('influx_get_io_profile', ['initiator_id'], ['initiator_id', 'switch_name']),
      srv('pmax_get_array_perf', ['array_id'], ['array_id', 'window']),
      srv('volume_lookup_by_wwn', ['wwn'], ['wwn']),
    ];
    expect(toolContractCheckup(agent, server)).toEqual({ ok: true, problems: [] });
  });

  it('catches the real "tool ignores my filter" drift (server window not on the agent)', () => {
    const agent = [tool('pmax_get_array_perf', ['array_id'], ['array_id'])]; // no window
    const server = [srv('pmax_get_array_perf', ['array_id'], ['array_id', 'window'])];
    const r = toolContractCheckup(agent, server);
    expect(r.problems.map((p) => p.code)).toEqual(['optional-drift']);
  });
});

describe('toolContractCheckup — property + security', () => {
  it('property: identical agent/server sides never diverge (fuzz)', () => {
    for (let i = 0; i < 100; i++) {
      const props = [`a${i % 5}`, `b${i % 3}`];
      const req = i % 2 ? [props[0]] : [];
      const a = [tool(`t${i}`, req, props)];
      const s = [srv(`t${i}`, req, props)];
      expect(toolContractCheckup(a, s).ok).toBe(true);
      expect(toolContractCheckup(a, s).problems).toEqual([]);
    }
  });

  it('security: malformed / schema-less entries do not throw', () => {
    const agent = [{ name: 'no_schema' } as ServerToolEntry];
    const server = [{ name: 'no_schema' } as ServerToolEntry];
    expect(() => toolContractCheckup(agent, server)).not.toThrow();
    expect(toolContractCheckup(agent, server)).toEqual({ ok: true, problems: [] });
  });
});
