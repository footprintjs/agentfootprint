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
import {
  candidateForms,
  classifyToken,
  extractCandidates,
  readAnswer,
} from '../../../src/core/agent/evidence/extract.js';
import {
  countDigits,
  lookupForms,
  normalizeToken,
  tokenize,
} from '../../../src/tools/normalize.js';
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
import type { LLMMessage } from '../../../src/provider-contract/types.js';
import { figureCheckOf } from '../../../src/core/agent/evidence/figures.js';
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

  it('a glued-unit number is met on the LOOKUP side only (9.110.0): the index is never widened', () => {
    // The index keeps `1007us` as `1007us`; the candidate that came from a
    // glued token asks for `1007` AND `1007us` (`candidateForms`), so the
    // answer's `1007us` meets the result's. A bare candidate asks for its
    // own spelling alone, so a result's `latency 2024ms` does NOT ground an
    // answer's prose year `2024` — the gate is not weakened.
    expect(lookupForms('1007us')).toEqual(['1007us']);
    expect(lookupForms('1007')).toEqual(['1007']);
    expect(candidateForms({ value: '1007', shape: 'number', token: '1007us' })).toEqual([
      '1007',
      '1007us',
    ]);
    expect(candidateForms({ value: '1007', shape: 'number' })).toEqual(['1007']);
    expect(classifyToken('1007us', GATE)).toEqual({
      value: '1007',
      shape: 'number',
      token: '1007us',
    });
    expect(classifyToken('1007', GATE)).toEqual({ value: '1007', shape: 'number' });
    const history: LLMMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'tool',
        toolCallId: 'c1',
        toolName: 'next_record',
        content: 'p95 latency reading — node-1: 1007us (survey probe); latency 2024ms',
      },
    ];
    // (a) result `1007us`, answer `1007us` → grounded (a false accusation before).
    expect(check('node-1: 1007us', { history }).unsupported).toEqual([]);
    // (b) result `latency 2024ms`, answer's prose year → FLAGGED: a
    // millisecond reading does not ground a year.
    expect(check('in 2024 we migrated', { history }).unsupported).toEqual([
      { value: '2024', shape: 'number' },
    ]);
    // The rule's edge, stated: an answer spelling the reading BARE (`1,007 us`,
    // unit apart) asks for `1007` alone and is not met by `1007us` — the
    // conservative side of the same rule that keeps (b) flagged.
    expect(check('node-1: 1,007 us', { history }).unsupported).toEqual([
      { value: '1007', shape: 'number' },
    ]);
    // …and a reading nothing served is still caught.
    expect(check('node-1: 1014us', { history }).unsupported).toEqual([
      { value: '1014', shape: 'number' },
    ]);
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
      // A number wearing a unit also carries the glued spelling it was read
      // off (`token`, 9.110.0) — asserted as the shape, not a blank check.
      expect(classifyToken(token, GATE)).toEqual(
        shape === 'number' && /[a-z]/.test(token)
          ? { value: expect.any(String), shape, token }
          : { value: expect.any(String), shape },
      );
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
    // Every token the evidence index holds, asserted straight back. The
    // index is a Map of form → the turn that served it (9.83.0), so the
    // tokens are its KEYS.
    for (const value of [...corpus.values.keys()].slice(0, 400)) {
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

describe('regression: a typed answer in compact JSON is read value by value', () => {
  // `{"total":1200}` — once the quotes are separators, compact JSON leaves the
  // key's colon on the value. `:1200` read as an IDENTIFIER no result carries,
  // so a typed answer that copied the tool's own number was flagged, and
  // `rails` refused it. A key's colon — the one right after a key's closing
  // quote — is now a separator in text, on both sides; every other colon is
  // part of its value.
  const RESULT = { order: 'ORD-44710', total: 1200, count: 123, delta: -1500, ratio: 0.4512 };
  const history = [
    { role: 'tool', toolCallId: 'c1', content: JSON.stringify(RESULT) },
  ] as unknown as readonly LLMMessage[];
  const rails = resolveEvidenceGate({ posture: 'rails' });

  it("a key's colon is a separator in text; every other colon is part of its value", () => {
    expect(tokenize('{"total":1200,"count":123}')).toEqual(['total', '1200', 'count', '123']);
    expect(tokenize('{"delta":-1500,"rows":"41,200"}')).toEqual([
      'delta',
      '-1500',
      'rows',
      '41200',
    ]);
    expect(tokenize('"total" : 1200')).toEqual(['total', '1200']);
    // A colon INSIDE a value stays, quoted or not, as a key's value or in prose.
    expect(tokenize('{"addr":"::1234","port":":8080"}')).toEqual([
      'addr',
      '::1234',
      'port',
      ':8080',
    ]);
    expect(tokenize('The address is "::1234".')).toEqual(['the', 'address', 'is', '::1234']);
    expect(tokenize('{"note":"say \\":1200\\" twice"}')).toContain(':1200');
    for (const value of ['::1234', '::1', 'fe80::1', '2001:db8::1234', '::ffff:192.0.2.1']) {
      expect(normalizeToken(value)).toBe(value);
      expect(tokenize(`The address is ${value}`)).toContain(value);
    }
    expect(normalizeToken(':1200')).toBe(':1200');
    expect(normalizeToken(':fc1/3')).toBe(':fc1/3');
  });

  it('an IPv6 address never matches the number after its colons — either way round', () => {
    const counted = [
      { role: 'tool', toolCallId: 'c1', content: JSON.stringify({ count: 1234, n: 1 }) },
    ] as unknown as readonly LLMMessage[];
    for (const address of ['::1234', '2001:db8::1234', '::ffff:192.0.2.1', 'fe80::1']) {
      const flaggedValues = check(`The address is ${address}.`, {
        history: counted,
        gate: rails,
      }).unsupported.map((u) => u.value);
      expect(flaggedValues).toContain(address);
    }
    // …and a tool's address never grounds the bare number.
    const addressed = [
      { role: 'tool', toolCallId: 'c1', content: JSON.stringify({ addr: '::1234' }) },
    ] as unknown as readonly LLMMessage[];
    expect(
      check('The count is 1234.', { history: addressed, gate: rails }).unsupported.map(
        (u) => u.value,
      ),
    ).toEqual(['1234']);
    expect(
      check('The address is ::1234.', { history: addressed, gate: rails }).unsupported,
    ).toEqual([]);
  });

  it('a compact typed answer copying the result is clean, under every posture', () => {
    expect(check(JSON.stringify(RESULT), { history, gate: rails }).unsupported).toEqual([]);
    expect(check(JSON.stringify(RESULT, null, 2), { history, gate: rails }).unsupported).toEqual(
      [],
    );
  });

  it('an invented number in compact JSON is still flagged, by its own spelling', () => {
    const invented = JSON.stringify({ ...RESULT, total: 9750 });
    expect(check(invented, { history, gate: rails }).unsupported).toEqual([
      { value: '9750', shape: 'number' },
    ]);
  });

  it('a text result carrying compact JSON grounds the same number', () => {
    const text = [
      { role: 'tool', toolCallId: 'c1', content: 'export ok: {"total":1200} (1 row)' },
    ] as unknown as readonly LLMMessage[];
    expect(check('The total is 1200.', { history: text, gate: rails }).unsupported).toEqual([]);
  });
});

describe('regression: a typed answer is read value by value, arrays included', () => {
  // Read whole as text, compact JSON arrays glue their commas onto the values:
  // `[5,100]` read as the thousands-separated 5100 (a correct answer accused),
  // `[0.45,0.12]` as one identifier no result carries, and `[1200,9750]` as no
  // value at all (an invented 9750 never looked up). A JSON answer is now read
  // the way the evidence index reads a JSON result: key by key, leaf by leaf.
  const RESULT = { counts: [1200, 9750], ratios: [0.4512, 0.1201], small: [5, 100, 250] };
  const history = [
    { role: 'tool', toolCallId: 'c1', content: JSON.stringify(RESULT) },
  ] as unknown as readonly LLMMessage[];
  const rails = resolveEvidenceGate({ posture: 'rails' });
  const flaggedIn = (answer: string) =>
    check(answer, { history, gate: rails }).unsupported.map((u) => u.value);

  it('a compact answer copying the arrays is clean — no merged thousands, no joined identifier', () => {
    expect(flaggedIn(JSON.stringify(RESULT))).toEqual([]);
    expect(flaggedIn(JSON.stringify({ small: [5, 100] }))).toEqual([]);
  });

  it('an invented number inside an array is looked up and flagged', () => {
    expect(flaggedIn(JSON.stringify({ counts: [1200, 9999] }))).toEqual(['9999']);
    expect(flaggedIn(JSON.stringify({ deep: [{ id: 'ORD-99812', n: [1200] }] }))).toEqual([
      'ord-99812',
    ]);
  });

  it('keys are read too: an invented id used as a key is still flagged', () => {
    expect(flaggedIn(JSON.stringify({ 'ORD-99812': 1200 }))).toEqual(['ord-99812']);
  });

  it('text that only opens like JSON is read as text, and nesting is not a call depth', () => {
    expect(flaggedIn('{ not json } total 9999')).toEqual(['9999']);
    const deep = `${'['.repeat(20_000)}9999${']'.repeat(20_000)}`;
    // Either JSON.parse refuses the depth (text) or the walk reads it: no throw.
    expect(() => flaggedIn(deep)).not.toThrow();
  });
});

describe('regression: a JSON answer keeps each number as it was WRITTEN', () => {
  // Reading a typed answer through JSON.parse changed the numbers being
  // checked: 9007199254740993 became 9007199254740992 (and matched a result
  // that carried that), a 20-digit serial became 12345678901234567000 (and
  // matched nothing), and 5.20 lost the precision the rounding rule judges by.
  const historyOf = (content: string) =>
    [{ role: 'tool', toolCallId: 'c1', content }] as unknown as readonly LLMMessage[];
  const rails = resolveEvidenceGate({ posture: 'rails' });

  it('a large integer is compared digit for digit — no false pass past double precision', () => {
    const history = historyOf('{"id":9007199254740992}');
    expect(
      check('{"id":9007199254740993}', { history, gate: rails }).unsupported.map((u) => u.value),
    ).toEqual(['9007199254740993']);
    expect(check('{"id":9007199254740992}', { history, gate: rails }).unsupported).toEqual([]);
  });

  it('a large integer the tool carried as text is found — no false flag from rounding', () => {
    const history = historyOf('{"serial":"12345678901234567890"}');
    expect(check('{"serial":12345678901234567890}', { history, gate: rails }).unsupported).toEqual(
      [],
    );
  });

  it('trailing zeros are a spelling, not a different number', () => {
    const history = historyOf('{"total":1200}');
    expect(check('{"total":1200.0}', { history, gate: rails }).unsupported).toEqual([]);
  });

  it('under decimal rounding, 5.20 keeps its written precision against 5.249', () => {
    const history = historyOf('{"reading":5.249}');
    const gate = resolveEvidenceGate({ posture: 'rails', decimalRounding: true });
    const judge = (answer: string) =>
      checkAnswer(answer, {
        gate,
        evidence: evidenceFromHistory(history),
        exempt: new Set<string>(),
        figures: figureCheckOf(answer, history, gate),
      });
    // 5.249 rounds to 5.25 at two places, so a two-place 5.20 was never read.
    expect(judge('{"reading":5.20}').unsupported.map((u) => u.value)).toEqual(['5.2']);
    // One place: 5.2 is 5.249 honestly rounded.
    expect(judge('{"reading":5.2}').unsupported).toEqual([]);
  });
});

describe('regression: an answer longer than the gate reads says how much it never read', () => {
  // The gate reads at most 20,000 words and numbers of one answer. It used to
  // stop there silently: a clean verdict on the part it read looked exactly
  // like a clean verdict on the whole answer, and an invented value past the
  // line was never looked up. The reading now counts what it left unread.
  const CEILING = 20_000;
  const history = [
    { role: 'tool', toolCallId: 'c1', content: JSON.stringify({ order: 'ORD-44710' }) },
  ] as unknown as readonly LLMMessage[];

  it('a short answer is read whole: nothing unread, and the verdict carries no count', () => {
    expect(readAnswer('Order ORD-44710 totals 41,200.', GATE).unread).toBe(0);
    expect('unread' in check('Order ORD-44710.', { history })).toBe(false);
  });

  it('prose past the ceiling: the value after it is unread, and counted', () => {
    const answer = `${'word '.repeat(CEILING)}ORD-99812`;
    const reading = readAnswer(answer, GATE);
    expect(reading.candidates.map((c) => c.value)).not.toContain('ord-99812');
    expect(reading.unread).toBe(1);
    const verdict = check(answer, { history });
    expect(verdict.unsupported).toEqual([]);
    expect(verdict.unread).toBe(1);
  });

  it('a JSON answer past the ceiling counts every value it never read', () => {
    const answer = JSON.stringify(Array.from({ length: CEILING + 5_000 }, (_, i) => i % 10));
    expect(readAnswer(answer, GATE).unread).toBe(5_000);
  });

  it('values the old cap on JSON texts skipped are read when the words allow it', () => {
    // 30,000 empty strings hold no word to read, so the invented id after
    // them is within the ceiling — and is looked up.
    const answer = JSON.stringify([...Array.from({ length: 30_000 }, () => ''), 'ORD-99812']);
    const reading = readAnswer(answer, GATE);
    expect(reading.unread).toBe(0);
    expect(reading.candidates.map((c) => c.value)).toContain('ord-99812');
  });

  it('extractCandidates is the reading without its count, byte for byte', () => {
    const answer = `${'word '.repeat(CEILING)}ORD-99812 41200`;
    expect(extractCandidates(answer, GATE)).toEqual(readAnswer(answer, GATE).candidates);
  });
});

describe('regression: a typed answer is judged on its values, never on its field names', () => {
  // `.outputSchema()` fixes an answer's keys: they are the app's field names,
  // not values the model asserts. Read as values, a digit-bearing name —
  // `p95LatencyMs`, `sha256`, `ipv4`, `q3Revenue` — was an identifier no tool
  // result carried, and an enforcing validation withheld a correct answer.
  const result = 'p95 latency 1250 ms; digest 9f86d081884c7d65; address 10.0.0.12; revenue 41200';
  const history = [
    { role: 'tool', toolCallId: 'c1', content: result },
  ] as unknown as readonly LLMMessage[];
  const answer = JSON.stringify({
    p95LatencyMs: 1250,
    sha256: '9f86d081884c7d65',
    ipv4: '10.0.0.12',
    q3Revenue: 41200,
  });
  const typedCheck = (text: string, typed: boolean) =>
    checkAnswer(text, {
      gate: GATE,
      evidence: evidenceFromHistory(history),
      exempt: new Set<string>(),
      ...(typed && { typed: true }),
    });

  it('typed: the keys are not read, the values are', () => {
    const values = readAnswer(answer, GATE, { typed: true }).candidates.map((c) => c.value);
    expect(values).toEqual(['1250', '9f86d081884c7d65', '10.0.0.12', '41200']);
    expect(typedCheck(answer, true).unsupported).toEqual([]);
  });

  it('untyped, a JSON-shaped answer is read whole, keys included, as before', () => {
    expect(typedCheck(answer, false).unsupported.map((u) => u.value)).toEqual([
      'p95latencyms',
      'sha256',
      'ipv4',
      'q3revenue',
    ]);
  });

  it('an invented value is still flagged in a typed answer — in a string, a list or a nested object', () => {
    const invented = JSON.stringify({
      p95LatencyMs: 1250,
      note: 'see ORD-99812',
      ids: ['10.0.0.12', '10.0.0.99'],
      deep: { q3Revenue: 9750 },
    });
    expect(typedCheck(invented, true).unsupported.map((u) => u.value)).toEqual([
      'ord-99812',
      '10.0.0.99',
      '9750',
    ]);
  });

  it('a string VALUE that looks like a key is still a value', () => {
    // Only a string followed by `:` is a key; one followed by `,` or `]` is data.
    const listed = JSON.stringify({ tags: ['ORD-99812', 'p95LatencyMs'], n: 1250 });
    expect(typedCheck(listed, true).unsupported.map((u) => u.value)).toEqual([
      'ord-99812',
      'p95latencyms',
    ]);
  });

  it('contract: a typed answer keyed BY data is not judged on its keys (stated limit)', () => {
    // A map keyed by ids hides them from the gate; put such ids in values.
    expect(typedCheck(JSON.stringify({ 'ORD-99812': 1250 }), true).unsupported).toEqual([]);
  });
});
