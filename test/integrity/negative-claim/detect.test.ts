/**
 * negative-claim — the prose grammar (design § 5.2, `detect.ts`): a fixed set of phrases, no
 * model, Unicode-, Markdown- and clause-aware, linear in the text.
 *
 * Test types: unit (each pack's forms; what is NOT a claim; hedges leave a claim flat; clause
 * splitting; table rows and list items as units; code; language) · negative (bare "every" and
 * "zero"; English carrying a foreign name) · boundary (spans index the text as given; NFC and
 * case; curly apostrophes) · performance (adversarial inputs stay linear — the grammar is
 * untrusted-input safe).
 */
import { describe, expect, it } from 'vitest';

import { detectNegativeClaims } from '../../../src/integrity/negative-claim/detect.js';
import { NEGATIVE_CLAIM_PHRASES_VERSION } from '../../../src/integrity/negative-claim/phrases.js';

const kinds = (text: string) => detectNegativeClaims(text).claims.map((c) => c.kind);
const noteCodes = (text: string) => detectNegativeClaims(text).notes.map((n) => n.code);

describe('non-existence', () => {
  it.each([
    'There are no open incidents on payments.',
    'There were no alerts overnight.',
    'There have been no deploys today.',
    "There aren't any snapshots for vm-alpha.",
    'Payments has no incidents.',
    'The host had no failed jobs.',
    "The cluster doesn't have any volumes.",
    'No such service is registered.',
    'The VM does not exist.',
    "That array doesn't exist.",
    'vm-beta is not in the inventory.',
    'The VM was not found.',
    'None of the hosts are degraded.',
    'Nothing was deployed to search.',
    'Nothing has failed since Monday.',
    'We saw 0 incidents on payments.',
    'No incidents are open on payments.',
    'No unresolved events on the cluster.',
    'Payments has never had an incident.',
  ])('%s', (text) => {
    expect(kinds(text)).toEqual(['none']);
  });
});

describe('completeness, in a frame only', () => {
  it.each([
    'These are all the open incidents.',
    'That is every alert that fired.',
    "That's all the VMs on the host.",
    'Here is the complete list of arrays.',
    'The full list follows.',
    'All 3 VMs are powered on.',
    'All three VMs are powered on.',
    'Nothing else is running there.',
    'No other host uses that datastore.',
  ])('%s', (text) => {
    expect(kinds(text)).toEqual(['complete']);
  });
});

describe('not a claim', () => {
  it.each([
    'Every service is healthy.',
    'There were zero errors.',
    'Payments has two open incidents: INC-1 and INC-2.',
    'No, the deploy went out at 09:00 and succeeded.',
    'I could not confirm the backup status.',
    'The lookup returned two rows.',
    '',
  ])('%s', (text) => {
    expect(kinds(text)).toEqual([]);
  });
});

describe('hedges are not scope — a hedged claim is still a claim', () => {
  it.each([
    'Based on the logs, there are no open incidents.',
    'According to the store, payments has no incidents.',
    'It seems there are no alerts.',
    'There may be no incidents left.',
    'I could not confirm it, but there are no incidents on payments.',
  ])('%s', (text) => {
    expect(kinds(text)).toContain('none');
  });
});

describe('units and clauses', () => {
  it('a clause after "but" is its own unit with its own polarity', () => {
    const text = 'Payments has no incidents, but checkout has two.';
    const [claim, ...rest] = detectNegativeClaims(text).claims;
    expect(rest).toEqual([]);
    expect(text.slice(claim?.unit.start, claim?.unit.end)).toBe('Payments has no incidents,');
  });

  it.each(['however', 'except', 'although'])('"%s" splits a clause', (word) => {
    const text = `There are no alerts ${word} two incidents are open.`;
    const [claim] = detectNegativeClaims(text).claims;
    expect(text.slice(claim?.unit.start, claim?.unit.end)).toBe('There are no alerts');
  });

  it('a Markdown table row is ONE unit across its cells', () => {
    const text = '| service | incidents |\n|---|---|\n| payments | there are none of them |\n';
    const [claim] = detectNegativeClaims(text).claims;
    expect(text.slice(claim?.unit.start, claim?.unit.end)).toContain('| payments |');
  });

  it('a list item is one unit', () => {
    const text = '- payments: there are no incidents\n- checkout: two incidents\n';
    const claims = detectNegativeClaims(text).claims;
    expect(claims).toHaveLength(1);
    expect(text.slice(claims[0]?.unit.start, claims[0]?.unit.end)).toBe(
      'payments: there are no incidents',
    );
  });

  it('sentences are units: an identifier with dots does not split one', () => {
    const text = 'host-07.dc1.example.com has no VMs. The other host has three.';
    const [claim] = detectNegativeClaims(text).claims;
    expect(text.slice(claim?.unit.start, claim?.unit.end)).toBe(
      'host-07.dc1.example.com has no VMs.',
    );
  });
});

describe('code — a claim inside code is noted, never judged and never silent', () => {
  it('fenced code', () => {
    const text = 'Output:\n\n```\nthere are no incidents\n```\n\nDone.';
    expect(kinds(text)).toEqual([]);
    const [note] = detectNegativeClaims(text).notes;
    expect(note?.code).toBe('in-code-block');
    expect(text.slice(note?.span.start, note?.span.end)).toBe('there are no');
  });

  it('inline code', () => {
    const text = 'It printed `no such host` and stopped.';
    expect(kinds(text)).toEqual([]);
    expect(noteCodes(text)).toEqual(['in-code-block']);
  });

  it('a claim beside inline code is still a claim', () => {
    const text = 'The host `host-01` has no VMs.';
    expect(kinds(text)).toEqual(['none']);
    expect(noteCodes(text)).toEqual([]);
  });
});

describe('language — a closed stop-word set; an unsupported language is a note', () => {
  it.each([
    'No hay incidentes abiertos en payments.',
    'Es gibt keine offenen Vorfälle für payments.',
    "Il n'y a aucun incident ouvert sur payments.",
    '支付服务没有未解决的事件。',
  ])('%s', (text) => {
    expect(kinds(text)).toEqual([]);
    expect(noteCodes(text)).toEqual(['language-unsupported']);
  });

  it('English that carries a foreign name stays English', () => {
    expect(kinds('There are no incidents on the San José cluster.')).toEqual(['none']);
    expect(noteCodes('There are no incidents on the San José cluster.')).toEqual([]);
  });

  it('a mixed reply: the English sentence is checked, the other is noted', () => {
    const text = 'There are no incidents on payments. No hay incidentes en checkout.';
    expect(kinds(text)).toEqual(['none']);
    expect(noteCodes(text)).toEqual(['language-unsupported']);
  });
});

describe('spelling — NFC, case folding, apostrophes; spans index the text as given', () => {
  it('case does not matter', () => {
    expect(kinds('THERE ARE NO INCIDENTS.')).toEqual(['none']);
  });

  it('a curly apostrophe is an apostrophe', () => {
    expect(kinds('That array doesn’t exist.')).toEqual(['none']);
  });

  it('a decomposed character before the claim does not shift its span', () => {
    const text = 'Cafe\u0301: there are no incidents.';
    const [claim] = detectNegativeClaims(text).claims;
    expect(text.slice(claim?.span.start, claim?.span.end)).toBe('there are no');
  });

  it('every hit carries its phrase id and the pack version', () => {
    const [claim] = detectNegativeClaims('There are no incidents.').claims;
    expect(claim?.phraseId).toMatch(/^none\./);
    expect(claim?.packVersion).toBe(NEGATIVE_CLAIM_PHRASES_VERSION);
  });

  it('is deterministic', () => {
    const text = 'There are no incidents. These are all the hosts. `no such`';
    expect(detectNegativeClaims(text)).toEqual(detectNegativeClaims(text));
  });
});

describe('PERFORMANCE — adversarial input stays linear', () => {
  it.each([
    ['repeated claim words', 'there are no '.repeat(20_000)],
    ['one long token', `${'a-'.repeat(60_000)}b`],
    ['table pipes', '|'.repeat(120_000)],
    ['backticks', '`'.repeat(120_000)],
    ['fences', '```\n'.repeat(30_000)],
    ['no-space letters', 'x'.repeat(200_000)],
  ])('%s', (_name, text) => {
    const started = performance.now();
    detectNegativeClaims(text);
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
