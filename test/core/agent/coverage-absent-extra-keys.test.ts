/**
 * A recognized absence's OWN keys are evidence — all of them except the echo.
 *
 * The field failure: a lookup tool that found nothing returned its absence
 * with the answer attached — an extra `known_shares` key holding the 40 real
 * share names on the filer — and a `try_instead` telling the model to pick one
 * of them. The model did exactly that. The evidence gate then called the share
 * it picked ungrounded, because the absence projection indexed the coverage
 * lists and nothing else: following the tool's own advice produced a flagged
 * answer.
 *
 * The split this file pins is the whole design. `looked_for` ECHOES the
 * caller's requested name, so indexing it would let a fabricated request
 * ground itself by being handed to one tool that found nothing — the cheapest
 * laundering machine, and the reason the projection was narrow to begin with.
 * Every other field of an absence is the TOOL speaking about the world, and
 * tool knowledge is exactly what the corpus is for. Tool-authored knowledge
 * grounds; caller echoes never do.
 *
 * Sections follow Convention 3: Unit (the projection) · Functional (the ledger
 * -wrapped shape) · Integration (the known_shares scenario through the real
 * loop) · Security (the laundering fence, unmoved) · Edge · Regression.
 */

import { describe, expect, it } from 'vitest';

import { absent, coverage, defineTool, Agent, type ToolAbsence } from '../../../src/index.js';
import { absenceEvidenceProjection } from '../../../src/core/agent/coverage/index.js';
import { mock } from '../../../src/llm-providers.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/**
 * Real share names the filer serves — the tool's own knowledge, attached to
 * the absence so the model has somewhere to go. Each carries a digit because
 * the gate's extractor only makes a candidate of a token that has one; a
 * purely alphabetic name would pass this file's assertions without the gate
 * ever judging it.
 */
const KNOWN_SHARES = ['finance_archive_01', 'hr_payroll_2024', 'eng_builds_2023'] as const;

/** A name the MODEL invented and handed to the tool. Never in KNOWN_SHARES. */
const INVENTED = 'quarterly_reports_v2';

/** A second filer the tool names in its own advice — tool prose, not a list. */
const OTHER_FILER = 'nas-fil-02';

const absenceWithShares = (lookedFor: string): ToolAbsence & { known_shares: readonly string[] } =>
  ({
    ...absent({
      what: `a share named ${lookedFor}`,
      checked: ['nas-fil-01: the exported share table'],
      tryInstead: `Pick one of the names in known_shares, or ask again against ${OTHER_FILER}.`,
    }),
    known_shares: KNOWN_SHARES,
  } as ToolAbsence & { known_shares: readonly string[] });

/** Every string the projection would put into the corpus, flattened. */
const leavesOf = (value: unknown): string[] => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    else if (typeof node === 'number' || typeof node === 'boolean') out.push(String(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(value);
  return out;
};

const projectedText = (parsed: unknown): string =>
  leavesOf(absenceEvidenceProjection(parsed)).join(' | ');

const shareLookup = defineTool<{ name?: string }, unknown>({
  name: 'find_share',
  description: 'Look up one share by name',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  execute: ({ name }) => absenceWithShares(String(name)),
});

type Ev = Record<string, unknown>;

const runWithGate = async (args: { replies: readonly unknown[]; message: string }) => {
  const checks: Ev[] = [];
  const agent = Agent.create({
    provider: mock({ replies: args.replies as never }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You answer questions about a file server.')
    .tool(shareLookup)
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .watch({
      id: 'capture-checks',
      onEmit: (e: { name: string; payload?: Ev }) => {
        if (e.name === 'agentfootprint.agent.evidence_checked') checks.push(e.payload ?? {});
      },
    })
    .build();
  await agent.run(args.message);
  const verdict = checks.at(-1);
  return ((verdict?.unsupported as Array<{ value: string }> | undefined) ?? []).map((u) => u.value);
};

const call = (args: Record<string, unknown>) => ({
  content: '',
  toolCalls: [{ id: 't1', name: 'find_share', args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

// ─────────────────────────────────────────────────────────────────────────
// Unit — the projection widens to the whole envelope, minus the echo
// ─────────────────────────────────────────────────────────────────────────

describe('unit: a recognized absence projects every field it authored', () => {
  it("carries an extra key's values — the answer the tool attached to its own absence", () => {
    const text = projectedText(absenceWithShares(INVENTED));
    for (const share of KNOWN_SHARES) expect(text).toContain(share);
  });

  it('carries the tool-authored `try_instead` and the library `note`', () => {
    const text = projectedText(absenceWithShares(INVENTED));
    expect(text).toContain(OTHER_FILER);
    expect(text).toContain('The search ran and matched nothing');
  });

  it('still EXCLUDES `looked_for` — the one field that quotes the caller', () => {
    expect(projectedText(absenceWithShares(INVENTED))).not.toContain(INVENTED);
  });

  it('leaves a non-absence result alone — `undefined` means "index it as you always did"', () => {
    expect(absenceEvidenceProjection({ rows: [1, 2] })).toBeUndefined();
    expect(absenceEvidenceProjection('not json')).toBeUndefined();
    // Marker present but no coverage → not an absence this library minted.
    expect(absenceEvidenceProjection({ af_absent: true, checked: [] })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — a ledger-wrapped absence gets the same split
// ─────────────────────────────────────────────────────────────────────────

describe('functional: `coverage(absent(…), …)` widens with its inner absence', () => {
  const wrapped = coverage(absenceWithShares(INVENTED), {
    checked: ['nas-fil-01'],
    cannotCover: [{ what: 'the DR filer', why: 'no collector there' }],
  });

  it("projects the ledger's own lists, the inner extra key, and not the echo", () => {
    const text = projectedText(wrapped);
    expect(text).toContain('finance_archive_01');
    expect(text).toContain('the DR filer');
    expect(text).not.toContain(INVENTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the field scenario, through the real loop and the real gate
// ─────────────────────────────────────────────────────────────────────────

describe('integration: following the absence’s own advice produces a grounded answer', () => {
  it('a share named from the absence’s extra key is NOT flagged', async () => {
    const unsupported = await runWithGate({
      message: 'is there a share for the reports?',
      replies: [
        call({ name: INVENTED }),
        final('No such share exists. This filer serves hr_payroll_2024.'),
      ],
    });
    expect(unsupported).not.toContain('hr_payroll_2024');
  });

  it("the tool's `try_instead` prose is grounded too — it is the tool's sentence, not the caller's", async () => {
    const unsupported = await runWithGate({
      message: 'is there a share for the reports?',
      replies: [call({ name: INVENTED }), final(`Ask again against ${OTHER_FILER}.`)],
    });
    expect(unsupported).not.toContain(OTHER_FILER);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security — the laundering fence is exactly where it was
// ─────────────────────────────────────────────────────────────────────────

describe('security: a failed lookup still cannot ground the name it was asked for', () => {
  it('an answer repeating the fabricated `looked_for` name still FAILS the gate', async () => {
    const unsupported = await runWithGate({
      message: 'is there a share for the reports?',
      replies: [call({ name: INVENTED }), final(`The share ${INVENTED} holds nothing.`)],
    });
    expect(unsupported).toContain(INVENTED);
  });

  it('a value the USER supplied stays exempt, absence or no absence', async () => {
    const unsupported = await runWithGate({
      message: `is there a share called ${INVENTED}?`,
      replies: [call({ name: INVENTED }), final(`The share ${INVENTED} holds nothing.`)],
    });
    expect(unsupported).not.toContain(INVENTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge
// ─────────────────────────────────────────────────────────────────────────

describe('edge: absences that carry nothing extra', () => {
  it('a bare absence still grounds its coverage and still withholds its echo', () => {
    const bare = absent({ what: INVENTED, checked: ['the only table there is'] });
    const text = projectedText(bare);
    expect(text).toContain('the only table there is');
    expect(text).not.toContain(INVENTED);
  });

  it('a number-valued extra key is projected as evidence', () => {
    const withCount = { ...absent({ what: 'x', checked: ['a source'] }), share_count: 40 };
    expect(projectedText(withCount)).toContain('40');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression
// ─────────────────────────────────────────────────────────────────────────

describe('regression: the coverage lists ground exactly as they did', () => {
  it('an answer citing where the search looked is unflagged', async () => {
    const unsupported = await runWithGate({
      message: 'is there a share for the reports?',
      replies: [call({ name: INVENTED }), final('nas-fil-01 was searched and returned nothing.')],
    });
    expect(unsupported).not.toContain('nas-fil-01');
  });
});
