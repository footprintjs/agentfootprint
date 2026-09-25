/**
 * The closed template table — every template's golden, the anti-drift laws, the
 * grammar helpers and the weakest-voucher rule.
 *
 * Test types:
 *   - UNIT        — `count`, `verb`, `allOf`, `joinAnd`, `distance` (1, 2, 3,
 *                   windowed), `.atLeast` at 12, clipping;
 *   - REGRESSION  — one golden `{ text, parts, source }` per template id, and a
 *                   pinned digest of the table: a word change without a
 *                   version bump fails here;
 *   - CONVENTION  — no "a"/"an" before a placeholder; no rendered `{{`; a line
 *                   starts with fixed words or a `:code` tool id; every id a
 *                   reader writes is in the table and every table id is written
 *                   by a reader (or named as the op's);
 *   - SECURITY    — a var's value is never re-read as a template;
 *   - WEAKEST VOUCHER (B6) — per template: the sentence's voucher is the weakest
 *                   of its template's and its truth-deciding vars'; a label part
 *                   keeps its own voucher and never moves the sentence's.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  count,
  fillParts,
  joinAnd,
  MAX_VAR_CHARS,
  n,
  sentence,
  v,
  verb,
  weakest,
} from '../../../src/lib/answer-account/render.js';
import {
  ANSWER_ACCOUNT_TEMPLATE_SET_VERSION,
  ANSWER_ACCOUNT_TEMPLATES,
  type TemplateId,
} from '../../../src/lib/answer-account/templates.js';
import type { AccountSource, SentenceVar } from '../../../src/lib/answer-account/types.js';
import { golden } from './helpers.js';

const IDS = Object.keys(ANSWER_ACCOUNT_TEMPLATES) as TemplateId[];
const PLACEHOLDER = /\{\{([^}]+)\}\}/g;

/** The vars a template needs, with plausible values — derived from its own placeholders. */
function varsFor(id: TemplateId, source: AccountSource = 'library'): Record<string, SentenceVar> {
  const vars: Record<string, SentenceVar> = {};
  // A tool-vouched template names its tool through the `tool` var, printed or not.
  if (ANSWER_ACCOUNT_TEMPLATES[id].voucher === 'tool') vars.tool = v('lookup_volumes', source);
  for (const m of ANSWER_ACCOUNT_TEMPLATES[id].text.matchAll(PLACEHOLDER)) {
    const body = m[1]!;
    const counted = /^(?:count|allOf):([A-Za-z0-9_]+)/.exec(body);
    if (counted) {
      vars[counted[1]!] = n(2, source);
      continue;
    }
    const [name, kind] = body.split(':') as [string, string | undefined];
    if (kind === 'distance') {
      vars[name] = n(2, source);
      continue;
    }
    if (name === 'tool') vars.tool = v('lookup_volumes', source);
    else if (kind === 'skill') vars[name] = v(`${name}-skill-id`, source);
    else if (
      [
        'n',
        'top',
        'next',
        'failed',
        'refused',
        'declined',
        'notDispatched',
        'unreachable',
        'applicable',
        'reachable',
      ].includes(name)
    )
      vars[name] = n(1, source);
    else vars[name] = v(`${name} value`, source);
  }
  return vars;
}

describe('REGRESSION — one golden per template', () => {
  it('every template renders from its own placeholders; the table of renders is pinned', () => {
    const renders = Object.fromEntries(
      IDS.map((id) => {
        const s = sentence(id, { vars: varsFor(id) });
        return [`${id}@${s.template.version}`, { text: s.text, parts: s.parts, source: s.source }];
      }),
    );
    golden('templates.reference.json', renders);
  });

  it('a digest of the table is pinned — changing words needs a version bump (and a new digest)', () => {
    const table = IDS.sort().map((id) => [
      id,
      ANSWER_ACCOUNT_TEMPLATES[id].version,
      ANSWER_ACCOUNT_TEMPLATES[id].text,
      ANSWER_ACCOUNT_TEMPLATES[id].voucher,
    ]);
    const digest = createHash('sha256').update(JSON.stringify(table)).digest('hex');
    golden('templates.digest.txt', `set ${ANSWER_ACCOUNT_TEMPLATE_SET_VERSION} · ${digest}`);
  });
});

describe('CONVENTION — the words', () => {
  it('never "a" / "an" before a placeholder', () => {
    const offenders = IDS.filter((id) => /\b(a|an) \{\{/i.test(ANSWER_ACCOUNT_TEMPLATES[id].text));
    expect(offenders).toEqual([]);
  });

  it('no rendered text keeps a "{{"', () => {
    const leaks = IDS.filter((id) => sentence(id, { vars: varsFor(id) }).text.includes('{{'));
    expect(leaks).toEqual([]);
  });

  it('a LINE starts with fixed words, a `:code` tool id or a number (pieces, chips, items and composites excepted) — nothing a capital letter would change', () => {
    const pieces = /^(chip|part|distance|summary\.signals?$)|\.item|^howSure\.evidence\.value$/;
    const offenders = IDS.filter((id) => {
      if (pieces.test(id)) return false;
      const text = ANSWER_ACCOUNT_TEMPLATES[id].text;
      const numeric = /^\{\{(count:|unreachable\}\})/.test(text);
      return text.startsWith('{{') && !text.startsWith('{{tool:code}}') && !numeric;
    });
    expect(offenders).toEqual([]);
  });

  it('every id a reader writes is in the table, and every table id is written by a reader (or is the op’s)', () => {
    const dir = resolve(__dirname, '../../../src/lib/answer-account');
    const files = [
      ...readdirSync(dir),
      ...readdirSync(join(dir, 'facts')).map((f) => `facts/${f}`),
    ].filter((f) => f.endsWith('.ts'));
    const source = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    const used = new Set(
      [...source.matchAll(/'((?:[a-zA-Z]+)(?:\.[a-zA-Z]+)*)'/g)].map((m) => m[1]!),
    );
    const OP_OWNED = ['summary.notAvailable']; // printed by the hosting op when no recording exists (af-3)
    const unused = IDS.filter((id) => !used.has(id) && !OP_OWNED.includes(id));
    expect(unused).toEqual([]);
  });
});

describe('UNIT — grammar', () => {
  it('count / verb are explicit pairs', () => {
    expect(count(1, 'value', 'values')).toBe('1 value');
    expect(count(3, 'value', 'values')).toBe('3 values');
    expect(verb(1, 'was', 'were')).toBe('was');
    expect(verb(2, 'was', 'were')).toBe('were');
  });

  it('allOf: 1 → it, 2 → both, n → all n', () => {
    const say = (k: number) => fillParts('howSure.evidence.lookedUp', { lookedUp: n(k) }).text;
    expect(say(1)).toBe(
      'The library looked up 1 value from the answer in what the tools returned and found it.',
    );
    expect(say(2)).toBe(
      'The library looked up 2 values from the answer in what the tools returned and found both.',
    );
    expect(say(3)).toBe(
      'The library looked up 3 values from the answer in what the tools returned and found all 3.',
    );
  });

  it('joinAnd: ", " and " and "', () => {
    expect(joinAnd([])).toBe('');
    expect(joinAnd(['a'])).toBe('a');
    expect(joinAnd(['a', 'b'])).toBe('a and b');
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('distance: previous one, n answers back, and "at least" under a window strategy', () => {
    const say = (d: number, windowed: 0 | 1) =>
      fillParts('found.inView', {
        tool: v('t', 'library'),
        distance: n(d),
        distanceWindowed: n(windowed),
      }).text;
    expect(say(1, 0)).toBe(
      'The model could also see the result of t from an earlier answer (the previous one).',
    );
    expect(say(2, 0)).toBe(
      'The model could also see the result of t from an earlier answer (2 answers back).',
    );
    expect(say(3, 0)).toBe(
      'The model could also see the result of t from an earlier answer (3 answers back).',
    );
    expect(say(1, 1)).toBe(
      'The model could also see the result of t from an earlier answer (at least 1 answer back).',
    );
    expect(say(3, 1)).toBe(
      'The model could also see the result of t from an earlier answer (at least 3 answers back).',
    );
  });

  it('.atLeast at the event’s cap of 12', () => {
    expect(fillParts('howSure.evidence.flagged.atLeast', { n: n(12) }).text).toBe(
      'The library could not find at least 12 values from the answer in any tool result:',
    );
  });

  it('a var over 2,000 characters is clipped, flagged, and followed by part.clipped@1', () => {
    const long = v('x'.repeat(MAX_VAR_CHARS + 50), 'tool:t');
    expect(long.clipped).toBe(true);
    const s = sentence('checked.item.full', { vars: { what: long, tool: v('t', 'library') } });
    expect(s.text.endsWith('… (the rest is in the record)')).toBe(true);
    expect(s.text.length).toBeLessThan(MAX_VAR_CHARS + 40);
  });

  it('a missing var is a programming error — fill throws', () => {
    expect(() => fillParts('found.rows', { tool: v('t', 'library') })).toThrow(/needs var "n"/);
  });
});

describe('SECURITY — values are data, never templates', () => {
  it('a tool that writes "{{tool:code}}" in its own words gets those words printed', () => {
    const s = sentence('checked.item.full', {
      vars: { what: v("{{tool:code}} and {{count:n,'x','y'}}", 'tool:t'), tool: v('t', 'library') },
    });
    expect(s.text).toBe("{{tool:code}} and {{count:n,'x','y'}}");
  });
  it('parts are typed text — never HTML', () => {
    const s = sentence('asked', {
      vars: { question: v('<img src=x onerror=alert(1)>', 'person') },
    });
    expect(s.parts).toEqual([
      { text: '“' },
      { quote: '<img src=x onerror=alert(1)>', source: 'person' },
      { text: '”' },
    ]);
  });
});

describe('WEAKEST VOUCHER (B6) — per template', () => {
  const RANK: AccountSource[] = ['person', 'library', 'tool:lookup_volumes', 'model', 'app'];

  it.each(IDS.map((id) => [id]))('%s', (id) => {
    const template = ANSWER_ACCOUNT_TEMPLATES[id];
    const own: AccountSource =
      template.voucher === 'tool' ? 'tool:lookup_volumes' : template.voucher;
    // Every var vouched by the library: the template's own voucher decides (or library when stronger).
    const base = sentence(id, { vars: varsFor(id, 'library') });
    expect(base.source).toBe(weakest([own, 'library']));
    // Any truth-deciding var vouched by the app pulls the sentence down to app.
    const truthVars = Object.keys(varsFor(id)).filter((k) => !k.endsWith('Label'));
    if (truthVars.length > 0) expect(sentence(id, { vars: varsFor(id, 'app') }).source).toBe('app');
    // A hidden truth input (`basis`) counts too.
    expect(sentence(id, { vars: varsFor(id, 'library'), basis: ['app'] }).source).toBe('app');
    expect(RANK).toContain(base.source === 'tool:lookup_volumes' ? base.source : base.source);
  });

  it('a label part keeps its own voucher and never moves the sentence’s', () => {
    const s = sentence('understood.intent', {
      vars: { skill: v('array-inventory', 'library'), skillLabel: v('array estate report', 'app') },
    });
    expect(s.source).toBe('library');
    expect(s.parts).toContainEqual({ label: 'array estate report', source: 'app' });
    expect(s.text).toBe(
      "The library's routing picked the array estate report skill (array-inventory).",
    );
  });

  it('ranking: person > library > tool > model > app', () => {
    expect(weakest(['library', 'tool:x'])).toBe('tool:x');
    expect(weakest(['tool:x', 'model'])).toBe('model');
    expect(weakest(['model', 'app'])).toBe('app');
    expect(weakest(['person', 'library'])).toBe('library');
  });
});
