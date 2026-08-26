/**
 * #9 — string SHAPE at the pre-dispatch boundary: `pattern`, `minLength`,
 * `maxLength`.
 *
 * The field failure this exists to stop: a tool result ended with an offer
 * ("I can also map these ids to volume names"), the person answered "yes
 * please", and the model bound *that sentence* as the identifier argument and
 * dispatched. The tool's `inputSchema` DECLARED the identifier's shape — the
 * boundary simply did not read it, so a call that could never succeed cost a
 * round trip and the consumer hand-rolled an affirmative blocklist.
 *
 * The property under test is that a DECLARED shape is an ENFORCED shape, under
 * the same `toolArgValidation` dial and the same result shape as every other
 * pre-dispatch refusal — and that the refusal TEACHES: the path, the offending
 * value, the declared shape, and the parameter's own description.
 *
 * Sections follow Convention 3: Unit (the pure checks) · Functional (the
 * teaching message) · Integration (the real loop, all three dial modes) ·
 * Property (never throws) · Security (what is echoed and what still is not) ·
 * Edge (invalid regex, non-strings, unicode) · Regression.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  formatToolArgIssues,
  validateToolArgs,
} from '../../../src/core/agent/toolArgsValidation.js';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/** Eight colon-separated hex pairs — the shape the field tool declared. */
const WWN_PATTERN = '^[0-9a-f]{2}(:[0-9a-f]{2}){7}$';
const GOOD_WWN = '21:00:00:24:ff:8b:1c:04';

const wwnSchema = {
  type: 'object',
  properties: {
    wwn: {
      type: 'string',
      pattern: WWN_PATTERN,
      description: 'A world-wide name: eight colon-separated hex pairs.',
    },
  },
  required: ['wwn'],
} as const;

const issueAt = (
  args: unknown,
  schema: Readonly<Record<string, unknown>>,
  path: string,
): { path: string; expected: string; got: string; value?: string; hint?: string } | undefined =>
  validateToolArgs(args, schema).issues.find((issue) => issue.path === path);

/** Mock LLM: one bad call, then — once it has read the refusal — a good one. */
function correctingProvider(bad: Record<string, unknown>, good: Record<string, unknown>) {
  let calls = 0;
  return mock({
    respond: (req: { messages: readonly { role: string; content: string }[] }) => {
      calls++;
      if (calls === 1) {
        return {
          content: 'mapping',
          toolCalls: [{ id: 'c1', name: 'map_volume_names', args: bad }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use' as const,
        };
      }
      const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
      if (calls === 2 && lastTool?.content.includes('Invalid arguments')) {
        return {
          content: 'retrying',
          toolCalls: [{ id: 'c2', name: 'map_volume_names', args: good }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use' as const,
        };
      }
      return {
        content: `done after ${calls} llm calls`,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn' as const,
      };
    },
  });
}

const buildMapTool = (executions: unknown[]) =>
  defineTool<{ wwn: string }, string>({
    name: 'map_volume_names',
    description: 'Map one world-wide name to its volume name',
    inputSchema: wwnSchema,
    execute: ({ wwn }) => {
      executions.push(wwn);
      return `${wwn} → vol_ledger_01`;
    },
  });

// ─────────────────────────────────────────────────────────────────────────
// Unit — a declared shape is an enforced shape
// ─────────────────────────────────────────────────────────────────────────

describe('unit: `pattern` is enforced on string values', () => {
  it('rejects the affirmative sentence the field bound as an identifier', () => {
    const result = validateToolArgs({ wwn: 'yes please' }, wwnSchema);
    expect(result.ok).toBe(false);
    expect(issueAt({ wwn: 'yes please' }, wwnSchema, 'wwn')).toMatchObject({
      expected: `a string matching ${WWN_PATTERN}`,
      got: 'string',
      value: 'yes please',
    });
  });

  it('accepts a value that matches', () => {
    expect(validateToolArgs({ wwn: GOOD_WWN }, wwnSchema).ok).toBe(true);
  });

  it('is UNANCHORED, exactly as JSON Schema says — a bare pattern matches anywhere', () => {
    const schema = { type: 'object', properties: { id: { type: 'string', pattern: 'abc' } } };
    expect(validateToolArgs({ id: 'xxabcxx' }, schema).ok).toBe(true);
    expect(validateToolArgs({ id: 'xxxx' }, schema).ok).toBe(false);
  });

  it('applies to strings ONLY — a number under a pattern-bearing schema is untouched', () => {
    // JSON Schema: `pattern` is a string keyword. A non-string is judged by
    // `type` (or by nothing at all), never by the regex.
    const schema = { properties: { id: { pattern: '^x$' } } };
    expect(validateToolArgs({ id: 42 }, schema).ok).toBe(true);
    expect(validateToolArgs({ id: [1, 2] }, schema).ok).toBe(true);
  });

  it('reaches nested properties and array items with the usual paths', () => {
    const schema = {
      type: 'object',
      properties: {
        wwns: { type: 'array', items: { type: 'string', pattern: WWN_PATTERN } },
      },
    };
    const issue = issueAt({ wwns: [GOOD_WWN, 'yes please'] }, schema, 'wwns[1]');
    expect(issue?.value).toBe('yes please');
  });
});

describe('unit: `minLength` / `maxLength` are enforced on string values', () => {
  const bounded = {
    type: 'object',
    properties: { code: { type: 'string', minLength: 4, maxLength: 8 } },
  };

  it('rejects a string under minLength, naming the bound and the length that arrived', () => {
    expect(issueAt({ code: 'ab' }, bounded, 'code')).toMatchObject({
      expected: 'a string of at least 4 characters',
      got: 'string of length 2',
      value: 'ab',
    });
  });

  it('rejects a string over maxLength', () => {
    expect(issueAt({ code: 'abcdefghij' }, bounded, 'code')).toMatchObject({
      expected: 'a string of at most 8 characters',
      got: 'string of length 10',
    });
  });

  it('accepts the inclusive bounds', () => {
    expect(validateToolArgs({ code: 'abcd' }, bounded).ok).toBe(true);
    expect(validateToolArgs({ code: 'abcdefgh' }, bounded).ok).toBe(true);
  });

  it('ignores non-integer / negative bounds rather than inventing a rule', () => {
    const junk = {
      properties: {
        a: { type: 'string', minLength: 'four' },
        b: { type: 'string', maxLength: -1 },
        c: { type: 'string', minLength: 2.5 },
      },
    };
    expect(validateToolArgs({ a: 'x', b: 'xxxx', c: 'x' }, junk).ok).toBe(true);
  });

  it('one string-shape complaint per argument — the most specific one wins', () => {
    // `pattern` describes the value completely; adding "and it is too short"
    // is noise about the same single mistake.
    const both = {
      properties: { wwn: { type: 'string', pattern: WWN_PATTERN, minLength: 23 } },
    };
    const issues = validateToolArgs({ wwn: 'no' }, both).issues.filter((i) => i.path === 'wwn');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.expected).toBe(`a string matching ${WWN_PATTERN}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the refusal TEACHES
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the refusal names the path, the value, the shape, and the description', () => {
  it('carries the schema `description` as the issue hint', () => {
    expect(issueAt({ wwn: 'yes please' }, wwnSchema, 'wwn')?.hint).toBe(
      'A world-wide name: eight colon-separated hex pairs.',
    );
  });

  it('renders all four facts in the model-visible message', () => {
    const { issues } = validateToolArgs({ wwn: 'yes please' }, wwnSchema);
    const message = formatToolArgIssues('map_volume_names', issues);
    expect(message).toContain("Invalid arguments for tool 'map_volume_names'");
    expect(message).toContain("- 'wwn'"); // the path
    expect(message).toContain('"yes please"'); // the offending value, quoted
    expect(message).toContain(WWN_PATTERN); // the declared shape
    expect(message).toContain('eight colon-separated hex pairs'); // the description
    expect(message).toContain('call it again');
  });

  it('omits the hint line when the parameter declares no description', () => {
    const noDesc = { properties: { wwn: { type: 'string', pattern: WWN_PATTERN } } };
    const message = formatToolArgIssues('t', validateToolArgs({ wwn: 'nope' }, noDesc).issues);
    expect(message).toContain('"nope"');
    expect(message).not.toContain('described as');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the real loop, under every dial mode
// ─────────────────────────────────────────────────────────────────────────

describe('integration: the dial governs pattern exactly as it governs type', () => {
  it("'enforce' (default): the call never runs, the model reads the shape and corrects itself", async () => {
    const executions: unknown[] = [];
    const events: { enforced: boolean; issues: readonly unknown[] }[] = [];
    const agent = Agent.create({
      provider: correctingProvider({ wwn: 'yes please' }, { wwn: GOOD_WWN }),
      model: 'mock',
    })
      .tool(buildMapTool(executions))
      .build();
    agent.on('agentfootprint.validation.args_invalid' as never, (event) => {
      events.push((event as { payload: (typeof events)[0] }).payload);
    });

    const answer = await agent.run({ message: 'map the ids' });

    expect(executions).toEqual([GOOD_WWN]); // the sentence never reached the tool
    expect(String(answer)).toContain('done');
    expect(events).toHaveLength(1);
    expect(events[0]?.enforced).toBe(true);
    expect(events[0]?.issues).toContainEqual({
      path: 'wwn',
      expected: `a string matching ${WWN_PATTERN}`,
      got: 'string',
      value: 'yes please',
      hint: 'A world-wide name: eight colon-separated hex pairs.',
    });
  });

  it("'warn': the event fires with enforced:false and the call still dispatches", async () => {
    const executions: unknown[] = [];
    const events: { enforced: boolean }[] = [];
    const agent = Agent.create({
      provider: correctingProvider({ wwn: 'yes please' }, { wwn: GOOD_WWN }),
      model: 'mock',
      toolArgValidation: 'warn',
    })
      .tool(buildMapTool(executions))
      .build();
    agent.on('agentfootprint.validation.args_invalid' as never, (event) => {
      events.push((event as { payload: (typeof events)[0] }).payload);
    });

    await agent.run({ message: 'map the ids' });

    expect(executions).toEqual(['yes please']);
    expect(events).toHaveLength(1);
    expect(events[0]?.enforced).toBe(false);
  });

  it("'off': a consumer who switched validation off sees ZERO change", async () => {
    const executions: unknown[] = [];
    const events: unknown[] = [];
    const agent = Agent.create({
      provider: correctingProvider({ wwn: 'yes please' }, { wwn: GOOD_WWN }),
      model: 'mock',
      toolArgValidation: 'off',
    })
      .tool(buildMapTool(executions))
      .build();
    agent.on('agentfootprint.validation.args_invalid' as never, () => {
      events.push(1);
    });

    await agent.run({ message: 'map the ids' });

    expect(executions).toEqual(['yes please']);
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property — a schema is authored by hand; none of it may throw
// ─────────────────────────────────────────────────────────────────────────

describe('property: hostile schemas and hostile values never throw', () => {
  it('arbitrary pattern/length declarations are total', () => {
    const schemas: unknown[] = [
      { properties: { x: { type: 'string', pattern: 42 } } },
      { properties: { x: { type: 'string', pattern: null } } },
      { properties: { x: { type: 'string', pattern: '' } } },
      { properties: { x: { type: 'string', minLength: null } } },
      { properties: { x: { type: 'string', maxLength: Number.NaN } } },
      { properties: { x: { type: 'string', minLength: Number.POSITIVE_INFINITY } } },
    ];
    const values: unknown[] = ['', 'x', ' ', '😀'.repeat(10), 7, null, [], {}];
    for (const schema of schemas) {
      for (const value of values) {
        expect(() =>
          validateToolArgs({ x: value }, schema as Readonly<Record<string, unknown>>),
        ).not.toThrow();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security — what an issue is now allowed to echo, and what it still is not
// ─────────────────────────────────────────────────────────────────────────

describe('security: the echo is bounded and scoped to string-shape complaints', () => {
  it('caps the echoed value at 80 characters', () => {
    const long = 'a'.repeat(500);
    const schema = { properties: { x: { type: 'string', pattern: '^b+$' } } };
    const issue = issueAt({ x: long }, schema, 'x');
    expect(issue?.value?.length).toBeLessThanOrEqual(81); // 80 + the ellipsis
    expect(issue?.value?.endsWith('…')).toBe(true);
    expect(
      formatToolArgIssues('t', validateToolArgs({ x: long }, schema).issues).length,
    ).toBeLessThan(400);
  });

  it('type / enum / required / additionalProperties issues still echo NO value', () => {
    const sentinel = 'SECRET_VALUE_XYZ_4242';
    const schema = {
      type: 'object',
      properties: {
        city: { type: 'string' },
        units: { type: 'string', enum: ['celsius'] },
      },
      required: ['city'],
      additionalProperties: false,
    };
    const result = validateToolArgs({ units: sentinel, extra: sentinel }, schema);
    expect(result.ok).toBe(false);
    for (const issue of result.issues) expect(issue.value).toBeUndefined();
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain(sentinel);
    expect(formatToolArgIssues('t', result.issues)).not.toContain(sentinel);
  });

  it('a multi-line value is escaped into one line rather than pasted into the message', () => {
    const schema = { properties: { x: { type: 'string', pattern: '^ok$' } } };
    const message = formatToolArgIssues(
      't',
      validateToolArgs({ x: 'line one\nline two' }, schema).issues,
    );
    expect(message).toContain('line one\\nline two');
    expect(message.split('\n').filter((l) => l.startsWith("- 'x'"))).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge — a regex a schema author got wrong must not take dispatch with it
// ─────────────────────────────────────────────────────────────────────────

describe('edge: an unparseable `pattern` degrades to no-pattern, loudly', () => {
  it('does not throw, does not reject, and warns once for the developer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // `(` never closes — `new RegExp` throws on it.
      const schema = { properties: { x: { type: 'string', pattern: '^(unclosed' } } };
      expect(validateToolArgs({ x: 'anything at all' }, schema).ok).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('^(unclosed');

      // Warned once per broken pattern, not once per dispatch.
      validateToolArgs({ x: 'again' }, schema);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('an invalid pattern beside a valid length bound still enforces the bound', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const schema = {
        properties: { x: { type: 'string', pattern: '[bad', maxLength: 3 } },
      };
      expect(validateToolArgs({ x: 'toolong' }, schema).ok).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('counts UTF-16 code units, the same unit JSON Schema and String.length use', () => {
    const schema = { properties: { x: { type: 'string', maxLength: 1 } } };
    expect(validateToolArgs({ x: '😀' }, schema).ok).toBe(false); // length 2
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — the honest subset stays honest around the new keywords
// ─────────────────────────────────────────────────────────────────────────

describe('regression: the rest of the subset is unchanged', () => {
  it('a type mismatch still reports type names only, with no hint line', () => {
    const schema = { properties: { n: { type: 'number', description: 'A count.' } } };
    const issue = issueAt({ n: 'x' }, schema, 'n');
    expect(issue).toEqual({ path: 'n', expected: 'number', got: 'string' });
  });

  it('keywords outside the subset are still ignored (minimum, oneOf, format)', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        count: { type: 'number', minimum: 100 },
        mix: { oneOf: [{ type: 'string' }] },
      },
    };
    expect(validateToolArgs({ email: 'whatever', count: 1, mix: 42 }, schema).ok).toBe(true);
  });
});
