/**
 * The evidence gate's deterministic core (9.35.0) — the extractor, the
 * normalizer, the structural index, and the MEASURED false-positive rate on
 * realistic SAN answers.
 *
 * Sections follow Convention 3: Unit (normalize / classify) · Functional (the
 * whole check) · Property (invariants over generated tokens) · Security &
 * containment (substring laundering, injection framing) · Edge (empty,
 * truncation, huge) · Regression (the measured rate, pinned).
 *
 * The false-positive section is the point of the file. A gate that flags a
 * correct answer makes a weak model loop, which is the failure this library
 * exists to remove — so the rate is measured on answers written the way models
 * write them, and asserted at ZERO rather than assumed.
 */

import { describe, it, expect } from 'vitest';
import { classifyToken, extractCandidates } from '../../../src/core/agent/evidence/extract.js';
import {
  countDigits,
  lookupForms,
  normalizeToken,
  tokenize,
} from '../../../src/core/agent/evidence/normalize.js';
import {
  evidenceFromHistory,
  exemptFromRun,
} from '../../../src/core/agent/evidence/evidenceIndex.js';
import {
  buildEvidenceCorrection,
  checkAnswer,
  describeValues,
  EVIDENCE_CHECK_FRAME_PREFIX,
  evidenceRefusalSentence,
  resolveEvidenceGate,
} from '../../../src/core/agent/evidence/gate.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import { CORRECT_ANSWERS, FABRICATED_ANSWERS, toolMessages } from './fixtures/sanEvidence.js';

const GATE = resolveEvidenceGate();

const check = (
  answer: string,
  opts: {
    history?: readonly LLMMessage[];
    userMessage?: string;
    gate?: ReturnType<typeof resolveEvidenceGate>;
  } = {},
) => {
  const history = (opts.history ?? toolMessages()) as readonly LLMMessage[];
  return checkAnswer(answer, {
    gate: opts.gate ?? GATE,
    evidence: evidenceFromHistory(history),
    exempt: exemptFromRun({
      history,
      ...(opts.userMessage !== undefined && { userMessage: opts.userMessage }),
    }),
  });
};

const flagged = (answer: string, opts?: Parameters<typeof check>[1]): string[] =>
  check(answer, opts).unsupported.map((u) => u.value);

// ─────────────────────────────────────────────────────────────────────────
// Unit — normalisation is the same on both sides
// ─────────────────────────────────────────────────────────────────────────

describe('unit: normalizeToken', () => {
  it('strips thousands separators so prose matches JSON', () => {
    expect(normalizeToken('41,200')).toBe('41200');
    expect(normalizeToken('1,234,567')).toBe('1234567');
  });

  it('canonicalises a trailing .0 — a JSON float and its integer print', () => {
    expect(normalizeToken('2048.0')).toBe('2048');
    expect(normalizeToken(String(2048.0))).toBe('2048');
  });

  it('keeps big ids as digits rather than rounding them through Number', () => {
    const serial = '90071992547409931234';
    expect(normalizeToken(serial)).toBe(serial);
  });

  it('lowercases and drops decoration', () => {
    expect(normalizeToken('"FC1/3",')).toBe('fc1/3');
    expect(normalizeToken('$41,200.')).toBe('41200');
    expect(normalizeToken('78%')).toBe('78');
  });

  it('expands the 0x prefix so either side may drop it', () => {
    expect(lookupForms('0xef0101')).toEqual(['0xef0101', 'ef0101']);
    expect(lookupForms('fc1/3')).toEqual(['fc1/3']);
  });

  it('tokenizes markdown and punctuation without merging values', () => {
    expect(tokenize('| **fc1/3** | down |')).toContain('fc1/3');
    expect(tokenize('fc1/3,fc1/4')).toEqual(['fc1/3', 'fc1/4']);
    expect(tokenize('peaks at 41,200 IOPS.')).toContain('41200');
  });

  it('counts digits, which is the whole distinctiveness test', () => {
    expect(countDigits('21:00:00:24:ff:4a:12:03')).toBe(13);
    expect(countDigits('healthy')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit — the classifier: data vs prose
// ─────────────────────────────────────────────────────────────────────────

describe('unit: classifyToken treats prose as prose', () => {
  const prose = [
    'three',
    'first',
    'healthy',
    '3',
    '24',
    '47',
    '892', // 3 digits — under the bare-number threshold, deliberately
    '32g',
    '100mb',
    '47th',
    '2h',
    '48-port',
    '20/month',
    '24/7',
    '1/2',
    '-14.8',
    '3.1',
    'po1', // 3 chars — under the identifier length bar
    'a1',
  ];
  for (const token of prose) {
    it(`does not flag '${token}'`, () => {
      expect(classifyToken(token, GATE)).toBeUndefined();
    });
  }
});

describe('unit: classifyToken treats data as data', () => {
  const data: ReadonlyArray<[string, string]> = [
    ['0xef0101', 'identifier'],
    ['fc1/3', 'identifier'],
    ['21:00:00:24:ff:4a:12:03', 'identifier'],
    ['ucsb-b200-m5', 'identifier'],
    ['fch1234v5k6', 'identifier'],
    ['7.0.3', 'identifier'],
    ['2026-04-12t08:15:00z', 'identifier'],
    ['08:15', 'identifier'],
    ['41200', 'number'],
    ['18450', 'number'],
    ['786432', 'number'],
    ['1204itw', 'number'], // a number wearing a unit is still a number
  ];
  for (const [token, shape] of data) {
    it(`flags '${token}' as ${shape}`, () => {
      expect(classifyToken(token, GATE)).toEqual({ value: expect.any(String), shape });
    });
  }

  it('de-duplicates: a port named six times is one claim', () => {
    const found = extractCandidates('fc1/3 fc1/3 fc1/3 fc1/3 fc1/3 fc1/3', GATE);
    expect(found).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the check end to end
// ─────────────────────────────────────────────────────────────────────────

describe('functional: grounding against tool results', () => {
  it('grounds a value returned as a JSON string', () => {
    expect(flagged('The device on fc1/3 is stor-array05-ct1-fc0.')).toEqual([]);
  });

  it('grounds a value returned as a JSON NUMBER, written with separators', () => {
    expect(flagged('It peaks at 41,200 IOPS.')).toEqual([]);
  });

  it('grounds a value that appears only inside a longer string leaf', () => {
    // `21:00:00:24:ff:4a:12:03` lives inside show_flogi's `note` sentence.
    expect(flagged('The missing device is 21:00:00:24:ff:4a:12:03.')).toEqual([]);
  });

  it('grounds a value that appears only as an object KEY', () => {
    const history = [
      { role: 'tool', content: JSON.stringify({ '21:00:00:24:ff:4a:12:07': { vsan: 100 } }) },
    ] as unknown as readonly LLMMessage[];
    expect(flagged('WWPN 21:00:00:24:ff:4a:12:07 is registered.', { history })).toEqual([]);
  });

  it('flags the field-observed fabricated row', () => {
    const [field] = FABRICATED_ANSWERS;
    expect(flagged(field!.answer).sort()).toEqual([...field!.mustFlag].sort());
  });

  for (const { answer, mustFlag } of FABRICATED_ANSWERS.slice(1)) {
    it(`flags ${mustFlag.join(', ')}`, () => {
      for (const value of mustFlag) expect(flagged(answer)).toContain(value);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the exemptions
// ─────────────────────────────────────────────────────────────────────────

describe('functional: values the user supplied are never fabricated', () => {
  it('exempts a value from THIS turn user message', () => {
    const answer = 'I could not find anything for WWPN 21:00:00:24:ff:4a:12:77.';
    expect(flagged(answer)).toContain('21:00:00:24:ff:4a:12:77');
    expect(flagged(answer, { userMessage: 'check WWPN 21:00:00:24:ff:4a:12:77 please' })).toEqual(
      [],
    );
  });

  it('exempts a value from an earlier user turn in the conversation', () => {
    const history = [
      { role: 'user', content: 'my array is SHPMAXDLVAP001-FA0' },
      ...toolMessages(),
    ] as unknown as readonly LLMMessage[];
    expect(flagged('Nothing is logged in for SHPMAXDLVAP001-FA0.', { history })).toEqual([]);
  });

  it('exempts a value the app own system prompt supplied', () => {
    const history = toolMessages() as unknown as readonly LLMMessage[];
    const verdict = checkAnswer('Escalate to queue Q-4471-OPS.', {
      gate: GATE,
      evidence: evidenceFromHistory(history),
      exempt: exemptFromRun({
        history,
        systemPromptInjections: [
          {
            contentSummary: 'escalation policy',
            rawContent: 'Escalate storage faults to queue Q-4471-OPS.',
            contentHash: 'h',
            slot: 'system-prompt',
            source: 'skill',
            reason: 'test',
          },
        ],
      }),
    });
    expect(verdict.unsupported).toEqual([]);
  });

  it('does NOT exempt an assistant turn — that is how a fabrication launders', () => {
    const history = [
      { role: 'assistant', content: 'the alias is SHPMAXDLVAP001-FA0' },
      ...toolMessages(),
    ] as unknown as readonly LLMMessage[];
    expect(flagged('As I said, the alias is SHPMAXDLVAP001-FA0.', { history })).toContain(
      'shpmaxdlvap001-fa0',
    );
  });

  it('honours a declared exemption, string or pattern', () => {
    const gate = resolveEvidenceGate({ exempt: ['0xef0101', /^build-\d+$/] });
    expect(flagged('FCID 0xef0101 on build-8841.', { gate })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — declared shapes
// ─────────────────────────────────────────────────────────────────────────

describe('functional: declared shapes compose with the defaults', () => {
  const gate = resolveEvidenceGate({
    shapes: [{ name: 'ticket', match: /[a-z]{3}-[a-z]{4}/ }],
  });

  it('catches a shape the conservative default would never flag', () => {
    // No digits at all — invisible to the default rule, caught by the shape.
    expect(flagged('Filed as ops-open.', { gate })).toEqual(['ops-open']);
    expect(flagged('Filed as ops-open.')).toEqual([]);
  });

  it('labels the flagged value with the shape name', () => {
    expect(check('Filed as ops-open.', { gate }).unsupported[0]).toEqual({
      value: 'ops-open',
      shape: 'ticket',
    });
  });

  it('still applies the default rules beside it', () => {
    expect(flagged('FCID 0xef0101 filed as ops-open.', { gate }).sort()).toEqual(
      ['0xef0101', 'ops-open'].sort(),
    );
  });

  it('anchors a shape to a whole token, so it cannot match inside a longer one', () => {
    const g = resolveEvidenceGate({ shapes: [{ name: 'four', match: /\d{4}/ }] });
    // `41200` CONTAINS four digits but is not four digits.
    expect(classifyToken('41200', g)?.shape).toBe('number');
  });

  it('strips a g flag, which would otherwise skip every other token', () => {
    const g = resolveEvidenceGate({ shapes: [{ name: 'hex', match: /0x[0-9a-f]+/g }] });
    for (const token of ['0xaaa1', '0xbbb2', '0xccc3', '0xddd4']) {
      expect(classifyToken(token, g)?.shape).toBe('hex');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security & containment
// ─────────────────────────────────────────────────────────────────────────

describe('security: a substring is not evidence', () => {
  it('refuses to ground a value that only appears inside an unrelated field', () => {
    const history = [
      { role: 'tool', content: JSON.stringify({ note: 'see naa.0xef0101ab for details' }) },
    ] as unknown as readonly LLMMessage[];
    expect(flagged('The FCID is 0xef0101.', { history })).toEqual(['0xef0101']);
  });

  it('does not ground from the model own tool ARGUMENTS', () => {
    const history = [
      // The assistant proposed the value; only the RESULT is evidence.
      { role: 'assistant', content: JSON.stringify({ port: 'fc9/9' }) },
      { role: 'tool', content: JSON.stringify({ error: 'no such interface' }) },
    ] as unknown as readonly LLMMessage[];
    expect(flagged('Port fc9/9 does not exist.', { history })).toContain('fc9/9');
  });
});

describe('security: the correction frames untrusted text', () => {
  it('puts the library words first and the quoted values last', () => {
    const [answerTurn, correction] = buildEvidenceCorrection('bad answer', [
      { value: '0xef0101', shape: 'identifier' },
    ]);
    expect(answerTurn).toEqual({ role: 'assistant', content: 'bad answer' });
    expect(correction.content.startsWith(EVIDENCE_CHECK_FRAME_PREFIX)).toBe(true);
    expect(correction.content.trimEnd().endsWith('`0xef0101` (identifier)')).toBe(true);
  });

  it('truncates the named list rather than pasting a whole answer back', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      value: `0xaa${i}`,
      shape: 'identifier',
    }));
    const rendered = describeValues(many);
    expect(rendered).toContain('and 28 more');
  });

  it('teaches: the refusal says what would satisfy it and admits its limit', () => {
    const sentence = evidenceRefusalSentence(
      [{ value: '0xef0101', shape: 'identifier' }],
      'rails',
      true,
    );
    expect(sentence).toContain('0xef0101');
    expect(sentence).toContain('survived the revision');
    expect(sentence).toContain('appears in a tool result');
    expect(sentence).toContain('cannot tell you whether a claim built from real values is true');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('edge: nothing to check', () => {
  it('an empty answer has no candidates', () => {
    expect(check('').candidates).toBe(0);
  });

  it('a prose-only answer has no candidates', () => {
    expect(check('I replaced the transceiver and the link came back up.').candidates).toBe(0);
  });

  it('no tool results at all: every value in the answer is unsupported', () => {
    expect(flagged('fc1/3 is down.', { history: [] })).toEqual(['fc1/3']);
  });

  it('a tool result that is not JSON is still evidence, tokenized', () => {
    const history = [
      { role: 'tool', content: 'fc1/3 is down (link_failure), last seen 0x650400' },
    ] as unknown as readonly LLMMessage[];
    expect(flagged('fc1/3 dropped; its FCID was 0x650400.', { history })).toEqual([]);
  });

  it('a JSON-looking result that does not parse falls back to text', () => {
    const history = [
      { role: 'tool', content: '{"interface": "fc1/3", truncated…' },
    ] as unknown as readonly LLMMessage[];
    expect(flagged('fc1/3 is the port.', { history })).toEqual([]);
  });

  it('refuses bad options at the call site, by name', () => {
    expect(() => resolveEvidenceGate({ posture: 'strict' as never })).toThrow(/not a posture/);
    expect(() => resolveEvidenceGate({ minDigits: 0 })).toThrow(/minDigits/);
    expect(() => resolveEvidenceGate({ shapes: [{ name: '', match: /x/ }] })).toThrow(
      /non-empty `name`/,
    );
    expect(() =>
      resolveEvidenceGate({
        shapes: [
          { name: 'a', match: /x/ },
          { name: 'a', match: /y/ },
        ],
      }),
    ).toThrow(/both named 'a'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property — invariants that must hold for any input
// ─────────────────────────────────────────────────────────────────────────

describe('property: invariants', () => {
  it('a value copied verbatim out of a tool result is NEVER flagged', () => {
    const history = toolMessages() as readonly LLMMessage[];
    const corpus = evidenceFromHistory(history);
    // Every token the evidence index holds, asserted straight back.
    for (const value of [...corpus.values].slice(0, 400)) {
      const verdict = checkAnswer(`The value is ${value}.`, {
        gate: GATE,
        evidence: corpus,
        exempt: new Set<string>(),
      });
      expect(verdict.unsupported).toEqual([]);
    }
  });

  it('normalisation is idempotent', () => {
    for (const raw of ['41,200', '"FC1/3",', '2048.0', '$78%', '0xEF0101']) {
      const once = normalizeToken(raw);
      expect(normalizeToken(once)).toBe(once);
    }
  });

  it('every flagged value came from the answer, never invented by the gate', () => {
    for (const { answer } of FABRICATED_ANSWERS) {
      const answerTokens = new Set(tokenize(answer));
      for (const u of check(answer).unsupported) {
        // Either the token itself, or the numeric part of a `1204itw`-style
        // token — in both cases something the answer really contains.
        expect(answerTokens.has(u.value) || answer.toLowerCase().includes(u.value)).toBe(true);
      }
    }
  });

  it('candidates ⊇ unsupported, always', () => {
    for (const answer of [...CORRECT_ANSWERS, ...FABRICATED_ANSWERS.map((f) => f.answer)]) {
      const v = check(answer);
      expect(v.candidates).toBeGreaterThanOrEqual(v.unsupported.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — the MEASURED false-positive rate
// ─────────────────────────────────────────────────────────────────────────

describe('regression: measured false-positive rate on realistic answers', () => {
  it('flags NOTHING in any correct answer (0 false positives)', () => {
    const misses: Array<{ answer: string; values: string[] }> = [];
    for (const answer of CORRECT_ANSWERS) {
      const values = flagged(answer);
      if (values.length > 0) misses.push({ answer: answer.slice(0, 60), values });
    }
    // Printed rather than only asserted: when this breaks, the failure should
    // say WHICH sentence and WHICH token, not just "expected 0".
    expect(misses).toEqual([]);
  });

  it('measures the rate per VALUE, not only per answer — and pins the numbers', () => {
    let candidates = 0;
    let falsePositives = 0;
    let answersFlagged = 0;
    for (const answer of CORRECT_ANSWERS) {
      const v = check(answer);
      candidates += v.candidates;
      falsePositives += v.unsupported.length;
      if (v.unsupported.length > 0) answersFlagged += 1;
    }
    // Pinned rather than bounded, in BOTH directions. `candidates` falling is
    // the extractor quietly going blind — a gate that flagged nothing because
    // it examined nothing would sail through a `falsePositives === 0` check
    // on its own. As of 9.35.0: 12 realistic answers, 32 distinct values
    // grounded, 0 flagged.
    expect({ answers: CORRECT_ANSWERS.length, candidates, falsePositives, answersFlagged }).toEqual(
      { answers: 12, candidates: 32, falsePositives: 0, answersFlagged: 0 },
    );
  });

  it('measures the other side too: 4 planted fabrications, 5 values, none missed', () => {
    let flaggedValues = 0;
    let missed = 0;
    for (const { answer, mustFlag } of FABRICATED_ANSWERS) {
      const v = check(answer);
      flaggedValues += v.unsupported.length;
      for (const m of mustFlag) if (!v.unsupported.some((u) => u.value === m)) missed += 1;
    }
    // 5 flagged and 5 planted: the fabricated corpus produces no COLLATERAL
    // flags either — the real values sitting beside the invented ones ground.
    expect({ flaggedValues, missed }).toEqual({ flaggedValues: 5, missed: 0 });
  });

  it('states what it CANNOT catch, so nobody reads the pass as a truth claim', () => {
    // 1. A false claim assembled entirely from real values. `fc1/3` is in the
    //    evidence and "healthy" is a word; the data says the port is DOWN.
    expect(flagged('fc1/3 is healthy and passing traffic.')).toEqual([]);
    // 2. A real value attached to the wrong thing: 0x650400 belongs to fc1/5.
    expect(flagged('fc1/3 is logged in with FCID 0x650400.')).toEqual([]);
    // 3. A fabricated quantity below the bare-number threshold. Deliberate:
    //    `892 CRC errors` and `47 flaps` are how English writes quantities,
    //    and flagging them would make a weak model loop on correct prose.
    expect(flagged('The port logged 555 CRC errors.')).toEqual([]);
    // 4. A fabricated name with no digits at all — invisible to the default
    //    rule, which is what `shapes` is for.
    expect(flagged('The array is esxi-host-alpha.')).toEqual([]);
  });

  it('catches every planted fabrication (0 false negatives on the corpus)', () => {
    for (const { answer, mustFlag } of FABRICATED_ANSWERS) {
      const values = flagged(answer);
      for (const expected of mustFlag) expect(values).toContain(expected);
    }
  });
});
