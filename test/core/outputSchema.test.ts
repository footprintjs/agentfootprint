/**
 * outputSchema — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins:
 *   - Builder: .outputSchema(parser, opts?) is chainable, throws on second call
 *   - Auto-injects an Instruction with default OR custom prompt text
 *   - applyOutputSchema(raw, parser) handles JSON-parse + validation phases
 *   - OutputSchemaError preserves rawOutput + stage + cause for triage
 *   - Agent.parseOutput() routes through the same applyOutputSchema
 *   - Agent.runTyped() runs + parses end-to-end
 *   - Duck-typed parser interface (Zod-shaped works; hand-written works)
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  OutputSchemaError,
  applyOutputSchema,
  buildDefaultInstruction,
  defineInstruction,
  mock,
  type OutputSchemaParser,
} from '../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

interface SupportTicket {
  status: 'ok' | 'err';
  items: readonly string[];
}

/** Hand-written parser that mimics zod's surface. Throws on shape failure. */
function makeTicketParser(opts?: { description?: string }): OutputSchemaParser<SupportTicket> {
  return {
    description: opts?.description,
    parse(value: unknown): SupportTicket {
      if (typeof value !== 'object' || value === null) {
        throw new Error('expected object');
      }
      const v = value as Record<string, unknown>;
      if (v.status !== 'ok' && v.status !== 'err') {
        throw new Error(`status must be 'ok' | 'err', got ${String(v.status)}`);
      }
      if (!Array.isArray(v.items) || !v.items.every((it) => typeof it === 'string')) {
        throw new Error('items must be string[]');
      }
      return { status: v.status, items: v.items };
    },
  };
}

// ─── 1. UNIT — applyOutputSchema two-stage error mapping ──────────

describe('applyOutputSchema — unit', () => {
  it('returns parser-typed value on valid JSON + valid shape', () => {
    const out = applyOutputSchema('{"status":"ok","items":["a","b"]}', makeTicketParser());
    expect(out).toEqual({ status: 'ok', items: ['a', 'b'] });
  });

  it('throws OutputSchemaError on JSON parse failure (stage: json-parse)', () => {
    try {
      applyOutputSchema('not-json', makeTicketParser());
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OutputSchemaError);
      const err = e as OutputSchemaError;
      expect(err.stage).toBe('json-parse');
      expect(err.rawOutput).toBe('not-json');
      expect(err.cause).toBeDefined();
    }
  });

  it('throws OutputSchemaError on schema validation failure (stage: schema-validate)', () => {
    try {
      applyOutputSchema('{"status":"WRONG","items":[]}', makeTicketParser());
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OutputSchemaError);
      const err = e as OutputSchemaError;
      expect(err.stage).toBe('schema-validate');
      expect(err.rawOutput).toBe('{"status":"WRONG","items":[]}');
      expect(err.cause).toBeDefined();
    }
  });
});

// ─── 2. SCENARIO — buildDefaultInstruction ────────────────────────

describe('buildDefaultInstruction — scenario', () => {
  it('emits the generic JSON-only sentence when parser has no description', () => {
    const instr = buildDefaultInstruction(makeTicketParser());
    expect(instr).toContain('valid JSON');
    expect(instr).toContain('Do NOT include prose');
    // No tail-sentence when description is absent
    expect(instr).not.toContain('output shape:');
  });

  it('appends parser.description when present', () => {
    const instr = buildDefaultInstruction(makeTicketParser({ description: '{ status, items[] }' }));
    expect(instr).toContain('output shape: { status, items[] }');
  });
});

// ─── 3. INTEGRATION — Agent builder + parseOutput / runTyped ──────

describe('Agent.outputSchema — integration', () => {
  it('builder method is chainable', () => {
    const provider = mock({
      respond: () => ({ content: '{"status":"ok","items":[]}', toolCalls: [] }),
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .outputSchema(makeTicketParser())
      .build();
    expect(agent).toBeDefined();
  });

  it('throws when outputSchema is called twice on the same builder', () => {
    const provider = mock({ respond: () => ({ content: '{}', toolCalls: [] }) });
    const builder = Agent.create({ provider, model: 'mock' })
      .system('s')
      .outputSchema(makeTicketParser());
    expect(() => builder.outputSchema(makeTicketParser())).toThrow(/already set/);
  });

  it('Agent.parseOutput parses + validates a manual raw string', () => {
    const provider = mock({ respond: () => ({ content: '{}', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .outputSchema(makeTicketParser())
      .build();
    const out = agent.parseOutput<SupportTicket>('{"status":"ok","items":["x"]}');
    expect(out).toEqual({ status: 'ok', items: ['x'] });
  });

  it('Agent.parseOutput throws if the agent has no outputSchema', () => {
    const provider = mock({ respond: () => ({ content: '{}', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' }).system('s').build();
    expect(() => agent.parseOutput('{"x":1}')).toThrow(/has no outputSchema/);
  });

  it('Agent.runTyped runs + parses end-to-end', async () => {
    const provider = mock({
      respond: () => ({ content: '{"status":"ok","items":["pending-1"]}', toolCalls: [] }),
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('You answer.')
      .outputSchema(makeTicketParser())
      .build();
    const typed = await agent.runTyped<SupportTicket>({ message: 'list' });
    expect(typed.status).toBe('ok');
    expect(typed.items).toEqual(['pending-1']);
  });

  it('Agent.runTyped throws OutputSchemaError when LLM returns malformed JSON', async () => {
    const provider = mock({
      respond: () => ({ content: 'I am not JSON.', toolCalls: [] }),
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .outputSchema(makeTicketParser())
      .build();
    try {
      await agent.runTyped({ message: 'go' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OutputSchemaError);
      expect((e as OutputSchemaError).stage).toBe('json-parse');
    }
  });

  it('outputSchema auto-injects an Instruction (visible in injection list)', () => {
    const provider = mock({ respond: () => ({ content: '{}', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .outputSchema(makeTicketParser({ description: '{ status, items[] }' }))
      .build();
    // Inspect the injection list via the agent's flowchart/internal state
    // is over-fitted; instead, run and observe the system prompt the LLM saw.
    let observedSystem = '';
    const probeProvider = mock({
      respond: (req: { systemPrompt?: string }) => {
        observedSystem = req.systemPrompt ?? '';
        return { content: '{"status":"ok","items":[]}', toolCalls: [] };
      },
    });
    const probeAgent = Agent.create({ provider: probeProvider, model: 'mock' })
      .system('Plain instructions.')
      .outputSchema(makeTicketParser({ description: '{ status, items[] }' }))
      .build();
    return probeAgent.runTyped({ message: 'go' }).then(() => {
      expect(observedSystem).toContain('valid JSON');
      expect(observedSystem).toContain('output shape: { status, items[] }');
    });
  });
});

// ─── 4. PROPERTY — invariants ─────────────────────────────────────

describe('outputSchema — properties', () => {
  it('applyOutputSchema is deterministic for valid input', () => {
    const parser = makeTicketParser();
    const raw = '{"status":"ok","items":["a"]}';
    const first = applyOutputSchema(raw, parser);
    for (let i = 0; i < 20; i++) {
      expect(applyOutputSchema(raw, parser)).toEqual(first);
    }
  });

  it('OutputSchemaError preserves raw output exactly (no truncation, no escape)', () => {
    const longRaw = `{"weird": "${'x'.repeat(5000)}"}`;
    try {
      applyOutputSchema(longRaw, makeTicketParser());
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OutputSchemaError);
      expect((e as OutputSchemaError).rawOutput).toBe(longRaw);
    }
  });
});

// ─── 5. SECURITY — hostile output handling ────────────────────────

describe('outputSchema — security', () => {
  it('handles prototype-pollution attempt: __proto__ in JSON does not contaminate result', () => {
    const parser: OutputSchemaParser<{ a: number }> = {
      parse(v: unknown): { a: number } {
        if (typeof v !== 'object' || v === null) throw new Error('expected object');
        const value = v as Record<string, unknown>;
        if (typeof value.a !== 'number') throw new Error('a must be number');
        return { a: value.a };
      },
    };
    const out = applyOutputSchema('{"a":1, "__proto__": {"polluted": true}}', parser);
    expect(out.a).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rawOutput on errors does not leak parser internals', () => {
    try {
      applyOutputSchema('garbage', makeTicketParser());
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as OutputSchemaError;
      // Verify raw is preserved verbatim
      expect(err.rawOutput).toBe('garbage');
      // Verify the message is the framework's, not the parser's stack
      expect(err.message).toContain('not valid JSON');
    }
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('outputSchema — performance', () => {
  it('applyOutputSchema for 1000 small payloads runs under 100ms', () => {
    const parser = makeTicketParser();
    const raw = '{"status":"ok","items":["a","b","c"]}';
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) applyOutputSchema(raw, parser);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── 7. ROI — what the contract unlocks ───────────────────────────

describe('outputSchema — ROI', () => {
  it('agentic code stops casting: typed.status is narrowed to "ok" | "err" at the call site', async () => {
    const provider = mock({
      respond: () => ({ content: '{"status":"err","items":["timeout"]}', toolCalls: [] }),
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .outputSchema(makeTicketParser())
      .build();
    const typed = await agent.runTyped<SupportTicket>({ message: 'go' });
    // TS-side: typed.status is narrowed; runtime: still verify
    expect(['ok', 'err']).toContain(typed.status);
    expect(typed.status).toBe('err');
    expect(typed.items).toEqual(['timeout']);
  });

  it('coexists with other Instructions: outputSchema injection does not collide with user-defined ones', () => {
    const provider = mock({ respond: () => ({ content: '{}', toolCalls: [] }) });
    const myInstr = defineInstruction({
      id: 'be-friendly',
      activeWhen: () => true,
      prompt: 'Be friendly.',
    });
    // Simply ensures build succeeds with both
    expect(() => {
      Agent.create({ provider, model: 'mock' })
        .system('s')
        .instruction(myInstr)
        .outputSchema(makeTicketParser())
        .build();
    }).not.toThrow();
  });
});
