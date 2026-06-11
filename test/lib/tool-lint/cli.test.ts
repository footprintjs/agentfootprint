/**
 * agentfootprint-lint-tools CLI core (RFC-002 C3) — functional tier.
 *
 * Exit-code contract (0 ok · 1 gate failed · 2 usage/input error), flag
 * handling, and the catalog coercion across OpenAI / Anthropic / MCP /
 * plain shapes. Tests call `runToolLintCli` directly (the bin wrapper is
 * a humble shell) with captured IO.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coerceCatalog, runToolLintCli } from '../../../src/lib/tool-lint';

const GOOD_TOOL = {
  name: 'lookup_record',
  description:
    'Looks up one record when its id is already known. Optional fields default to the full record.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'record id' } },
    required: ['id'],
  },
};

const BARE_TOOL = { name: 'mystery' }; // missing description → structural error

function withTempJson(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-lint-'));
  const file = join(dir, 'tools.json');
  writeFileSync(file, JSON.stringify(value));
  return file;
}

interface CapturedIO {
  readonly out: string[];
  readonly err: string[];
  readonly io: { stdout: (l: string) => void; stderr: (l: string) => void };
}

function captured(): CapturedIO {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (l) => out.push(l), stderr: (l) => err.push(l) } };
}

describe('runToolLintCli — exit codes', () => {
  it('0 on a clean catalog (similarity report-only without --threshold)', async () => {
    const { io, out } = captured();
    const code = await runToolLintCli([withTempJson([GOOD_TOOL])], io);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('RESULT: ok');
    expect(out.join('\n')).toContain('REPORT-ONLY');
  });

  it('1 when structural errors fail the gate', async () => {
    const { io, out } = captured();
    const code = await runToolLintCli([withTempJson([GOOD_TOOL, BARE_TOOL])], io);
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('RESULT: FAIL');
  });

  it('1 when --threshold gates a confusable pair', async () => {
    const twinA = {
      name: 'twin_alpha',
      description: 'Looks up the shared record store for items. Use only when syncing.',
    };
    const twinB = {
      name: 'twin_alphb',
      description: 'Looks up the shared record store for items. Use only when syncing.',
    };
    const { io, out } = captured();
    // Identical descriptions → cosine ≈ 1 under any embedder.
    const code = await runToolLintCli([withTempJson([twinA, twinB]), '--threshold', '0.99'], io);
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('CONFUSABLE');
    expect(out.join('\n')).toContain('you own the');
  });

  it('--strict makes warnings fail the gate', async () => {
    const short = { name: 'shorty', description: 'Too short for now.' };
    const lax = await runToolLintCli([withTempJson([short])], captured().io);
    const strict = await runToolLintCli([withTempJson([short]), '--strict'], captured().io);
    expect(lax).toBe(0);
    expect(strict).toBe(1);
  });

  it('2 on a missing file', async () => {
    const { io, err } = captured();
    const code = await runToolLintCli(['/nope/does-not-exist.json'], io);
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('does-not-exist.json');
  });

  it('2 on unrecognized JSON shape', async () => {
    const { io, err } = captured();
    const code = await runToolLintCli([withTempJson({ not: 'a tool list' })], io);
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('expected a JSON array');
  });

  it('2 on unknown flags / missing file argument (usage)', async () => {
    expect(await runToolLintCli(['tools.json', '--frobnicate'], captured().io)).toBe(2);
    expect(await runToolLintCli([], captured().io)).toBe(2);
    expect(await runToolLintCli(['--threshold', 'NaN'], captured().io)).toBe(2);
  });
});

describe('runToolLintCli — flags', () => {
  it('--json prints the machine-readable report', async () => {
    const { io, out } = captured();
    const code = await runToolLintCli([withTempJson([GOOD_TOOL]), '--json'], io);
    expect(code).toBe(0);
    const report = JSON.parse(out.join('\n'));
    expect(report).toMatchObject({ ok: true, toolCount: 1 });
    expect(report.similarity.analyzed).toBe(false); // 1 tool — nothing to pair
  });

  it('--no-similarity skips embedding entirely', async () => {
    const { io, out } = captured();
    const code = await runToolLintCli(
      [withTempJson([GOOD_TOOL, { ...GOOD_TOOL, name: 'lookup_record_two' }]), '--no-similarity'],
      io,
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('skipped (no embedder');
  });

  it('--top bounds the ranked-pairs section', async () => {
    const tools = ['a', 'b', 'c', 'd'].map((n) => ({
      ...GOOD_TOOL,
      name: `lookup_record_${n}`,
    }));
    const { io, out } = captured();
    await runToolLintCli([withTempJson(tools), '--top', '2'], io);
    const ranked = out.join('\n').match(/^\s+0\.\d{4}\s/gm) ?? [];
    expect(ranked).toHaveLength(2);
  });
});

describe('coerceCatalog — the zero-buy-in shapes', () => {
  it('plain [{ name, description, inputSchema }]', () => {
    expect(coerceCatalog([GOOD_TOOL])).toEqual([GOOD_TOOL]);
  });

  it('MCP tools/list result: { tools: [...] }', () => {
    expect(coerceCatalog({ tools: [GOOD_TOOL] })).toEqual([GOOD_TOOL]);
  });

  it("OpenAI: [{ type: 'function', function: { name, description, parameters } }]", () => {
    const openai = [
      {
        type: 'function',
        function: {
          name: GOOD_TOOL.name,
          description: GOOD_TOOL.description,
          parameters: GOOD_TOOL.inputSchema,
        },
      },
    ];
    expect(coerceCatalog(openai)).toEqual([GOOD_TOOL]);
  });

  it('Anthropic: [{ name, description, input_schema }]', () => {
    const anthropic = [
      {
        name: GOOD_TOOL.name,
        description: GOOD_TOOL.description,
        input_schema: GOOD_TOOL.inputSchema,
      },
    ];
    expect(coerceCatalog(anthropic)).toEqual([GOOD_TOOL]);
  });

  it('throws with the offending index on tools without a name', () => {
    expect(() => coerceCatalog([GOOD_TOOL, { description: 'nameless' }])).toThrow('tools[1]');
  });
});
