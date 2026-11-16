import { describe, expect, it } from 'vitest';
import { parseSkillFile } from './frontmatter.js';

const FILE = '/skills/alpha/SKILL.md';

function document(fields: readonly string[] = [], body = 'Body.'): string {
  return ['---', 'name: alpha', 'description: Short.', ...fields, '---', body].join('\n');
}

describe('skill file frontmatter', () => {
  it('accepts a BOM and CRLF while unquoting scalars and preserving body lines', () => {
    const raw = [
      '\ufeff---',
      'name: "alpha"',
      "description: 'Short: note.'",
      '---',
      '',
      'First line.',
      '',
      '  Second line.',
      '',
    ].join('\r\n');

    expect(parseSkillFile(raw, FILE)).toEqual({
      name: 'alpha',
      description: 'Short: note.',
      body: 'First line.\n\n  Second line.',
      file: FILE,
    });
  });

  it('keeps omitted optional keys absent rather than adding defaults', () => {
    const parsed = parseSkillFile(document(), FILE);

    expect(Object.keys(parsed)).toEqual(['name', 'description', 'body', 'file']);
    expect(parsed).toEqual({ name: 'alpha', description: 'Short.', body: 'Body.', file: FILE });
  });

  it('refuses explicitly empty tools, steps and routes instead of treating them as omitted', () => {
    for (const key of ['tools', 'steps', 'routes']) {
      expect(() => parseSkillFile(document([`${key}:`]), FILE)).toThrow(FILE);
      expect(() => parseSkillFile(document([`${key}:`]), FILE)).toThrow(
        `declares '${key}' with no`,
      );
    }
  });

  it('preserves tool declaration order in inline and block spellings', () => {
    const inline = parseSkillFile(document(['tools: second, "first"']), FILE);
    const block = parseSkillFile(document(['tools:', '  - second', '  - first']), FILE);

    expect(inline.toolNames).toEqual(['second', 'first']);
    expect(block.toolNames).toEqual(inline.toolNames);
  });

  it('refuses duplicate tool names in either spelling and names the file', () => {
    for (const fields of [['tools: first, first'], ['tools:', '  - first', '  - first']]) {
      expect(() => parseSkillFile(document(fields), FILE)).toThrow(FILE);
      expect(() => parseSkillFile(document(fields), FILE)).toThrow("lists the tool 'first' twice");
    }
  });

  it('retains repeated ordered steps, colon-bearing notes and either skip policy as data', () => {
    for (const policy of ['hold', 'advance']) {
      const parsed = parseSkillFile(
        document([
          'tools: first',
          'steps:',
          '  - first: Check: once.',
          "  - first: 'Check again.'",
          `onSkip: ${policy}`,
        ]),
        FILE,
      );

      expect(parsed.steps).toEqual([
        { tool: 'first', note: 'Check: once.' },
        { tool: 'first', note: 'Check again.' },
      ]);
      expect(parsed.onSkip).toBe(policy);
    }
  });

  it('reports the original file and line for an undeclared step or missing note', () => {
    for (const item of ['  - second: Check.', '  - first']) {
      const raw = document(['tools: first', 'steps:', item]);

      expect(() => parseSkillFile(raw, FILE)).toThrow(`'${FILE}' line 6`);
    }
    expect(() =>
      parseSkillFile(document(['tools: first', 'steps:', '  - second: Check.']), FILE),
    ).toThrow("step 'second' is not in this file's 'tools'");
  });

  it('refuses skip policies without steps and policies outside the closed pair', () => {
    expect(() => parseSkillFile(document(['onSkip: hold']), FILE)).toThrow(
      "declares 'onSkip' with no 'steps'",
    );
    expect(() =>
      parseSkillFile(
        document(['tools: first', 'steps:', '  - first: Check.', 'onSkip: later']),
        FILE,
      ),
    ).toThrow("declares onSkip 'later'");
  });

  it('delegates ordered route guards as data without resolving target skills', () => {
    const parsed = parseSkillFile(
      document([
        'tools: second, first',
        'routes:',
        '  - review: on second status=denied,failure',
        '  - receipts: status=success',
        '  - audit',
      ]),
      FILE,
    );

    expect(parsed.routes).toEqual([
      { to: 'review', onToolReturn: 'second', onToolStatus: ['denied', 'failure'], line: 6 },
      { to: 'receipts', onToolStatus: ['success'], line: 7 },
      { to: 'audit', line: 8 },
    ]);
  });

  it('refuses route expressions, unknown statuses and tools outside the declared list', () => {
    for (const guard of ['when true', 'status=invented', 'on other']) {
      const raw = document(['tools: first', 'routes:', `  - review: ${guard}`]);

      expect(() => parseSkillFile(raw, FILE)).toThrow(`'${FILE}' line 6`);
    }
    expect(() => parseSkillFile(document(['routes: review']), FILE)).toThrow(
      "writes 'routes' on one line",
    );
  });

  it('ignores unknown scalar and list keys and treats everything after the fence as body', () => {
    const body = 'tools:\n  - body-only\n\n# Text.';
    const parsed = parseSkillFile(
      document(['# Comment.', 'extra: value', 'other:', '  - item: note', '', 'last: done'], body),
      FILE,
    );

    expect(parsed).toEqual({ name: 'alpha', description: 'Short.', body, file: FILE });
  });
});
