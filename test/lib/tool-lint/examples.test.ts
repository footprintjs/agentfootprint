/**
 * Integration tests — run the three RFC-002 examples end-to-end and pin
 * their documented claims (Convention 2: examples ARE the
 * integration-test layer; if an example silently breaks, the guide
 * silently lies).
 *
 *   02 — the Neo fcns twin pair is flagged confusable with a hint
 *   03 — before fails the gate, after passes under the SAME options
 *   04 — margins + flags from a live agent run, embedder lazy
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { run as runLintExample } from '../../../examples/observability/02-lint-confusable-catalog.js';
import { run as runFixExample } from '../../../examples/observability/03-lint-fix-and-pass.js';
import { run as runMarginsExample } from '../../../examples/observability/04-tool-choice-margins.js';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe('example 02 — lint the Neo catalog', () => {
  it('flags the §7 acceptance pair and reports the field structural cases', async () => {
    const { report, fcnsPairFlagged, transcript } = await runLintExample();
    expect(fcnsPairFlagged).toBe(true);
    expect(report.ok).toBe(false);
    expect(transcript).toContain(
      '✗ flagged as expected: get_fcns_database <> influx_get_fcns_database',
    );
    expect(transcript).toContain('"enum": ["avg_iops","peak_iops","mbps"]');
  });
});

describe('example 03 — fix and pass', () => {
  it('before fails, after passes — same thresholds, same strictness', async () => {
    const { beforeReport, afterReport } = await runFixExample();
    expect(beforeReport.ok).toBe(false);
    expect(
      beforeReport.similarity.confusable.some(
        (p) => [p.a, p.b].sort().join('|') === 'get_fcns_database|influx_get_fcns_database',
      ),
    ).toBe(true);
    expect(beforeReport.structural.some((f) => f.severity === 'error')).toBe(true);

    expect(afterReport.ok).toBe(true);
    expect(afterReport.similarity.confusable).toHaveLength(0);
    expect(afterReport.structural).toHaveLength(0);
  });
});

describe('example 04 — runtime margins', () => {
  it('zero embeds during the run; both tool choices scored; the twin trap flagged', async () => {
    const { calls, flagged, summary, embedderCallsDuringRun } = await runMarginsExample();
    expect(embedderCallsDuringRun).toBe(0); // the lazy contract, end-to-end
    expect(summary.scored).toBe(2);
    expect(summary.choices).toBe(2);
    // The scripted run walks into the twin competition — both calls are
    // close calls under the proxy; at least the history-vs-live call flags.
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.skipped === 'nothing-chosen')).toBe(true); // the final answer
  });
});
