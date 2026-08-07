/**
 * Security tests — traceToolpack (B13 posture: bounded, redaction-respecting
 * views only).
 *
 *   1. Sentinel PII in artifacts never exceeds bounded previews — the
 *      passive views (overview / node / slice / who_wrote) can never leak a
 *      full long value; only the explicit get_value fetch can, and it is
 *      capped + truncation-marked.
 *   2. Redacted stays redacted — footprintjs scrubs the commit log at
 *      commit time; the toolpack passes the placeholder through verbatim,
 *      flags the key, and NEVER reconstructs the original from any view.
 */

import { flowChart, FlowChartExecutor } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { callTraceTool, traceToolpack, type TraceToolpackArtifacts } from '../../../src/observe.js';

// A long sentinel: unique head + bulky body + unique tail. Longer than every
// preview cap, so ANY appearance of the tail in a passive view is a leak.
const PII_HEAD = 'PII-SENTINEL-HEAD';
const PII_TAIL = 'PII-SENTINEL-TAIL';
const PII_VALUE = `${PII_HEAD}-${'9'.repeat(800)}-${PII_TAIL}`;
const SSN_SENTINEL = 'SSN-123-45-6789';

interface SecState {
  profile: string;
  ssn: string;
  summary: string;
}

async function runSecFixture(): Promise<TraceToolpackArtifacts> {
  const chart = flowChart<SecState>(
    'Collect',
    async (scope) => {
      scope.profile = PII_VALUE;
      scope.ssn = SSN_SENTINEL;
    },
    'collect',
    { description: 'Collect the applicant profile' },
  )
    .addFunction(
      'Summarize',
      async (scope) => {
        scope.summary = `profile bytes: ${scope.profile.length}, ssn on file: ${scope.ssn !== ''}`;
      },
      'summarize',
      'Summarize without exposing raw data',
    )
    .build();

  const executor = new FlowChartExecutor(chart);
  executor.setRedactionPolicy({ keys: ['ssn'] });
  executor.enableNarrative();
  await executor.run({});
  return {
    snapshot: executor.getSnapshot(),
    narrative: executor.getNarrativeEntries().map((e) => e.text),
  };
}

const artifacts = await runSecFixture();
const tools = traceToolpack(artifacts);

/** Every passive (non-get_value) view an LLM can open over this run. */
async function allPassiveViews(): Promise<string[]> {
  return Promise.all([
    callTraceTool(tools, 'run_overview'),
    callTraceTool(tools, 'trace_node', { runtimeStageId: 'collect#0' }),
    callTraceTool(tools, 'trace_node', { runtimeStageId: 'summarize#1' }),
    callTraceTool(tools, 'trace_slice', { runtimeStageId: 'summarize#1' }),
    callTraceTool(tools, 'who_wrote', { key: 'profile' }),
    callTraceTool(tools, 'who_wrote', { key: 'ssn' }),
    callTraceTool(tools, 'read_narrative', { maxLines: 200 }),
    // A search is a passive view too — and the one an attacker would reach
    // for first, because it takes free text rather than a key it must know.
    callTraceTool(tools, 'find_in_trace', { query: PII_HEAD, maxHits: 25 }),
    callTraceTool(tools, 'find_in_trace', { query: '123-45', maxHits: 25 }),
    callTraceTool(tools, 'find_in_trace', { query: 'ssn', maxHits: 25 }),
  ]);
}

describe('traceToolpack — security: bounded previews never leak long values', () => {
  it('no passive view ever serves the full sentinel (the tail stays unserved)', async () => {
    const views = await allPassiveViews();
    for (const view of views) {
      expect(view).not.toContain(PII_VALUE);
      expect(view).not.toContain(PII_TAIL); // beyond every preview cap
    }
    // The preview is honest about what it withheld.
    const node = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'collect#0' });
    expect(node).toMatch(/profile \(set\): .*chars total/);
  });

  it('get_value (the explicit fetch) is capped and truncation-marked, never silent', async () => {
    const out = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'collect#0',
      key: 'profile',
      maxChars: 100,
    });
    expect(out).toContain(PII_HEAD); // the deliberate fetch serves the head…
    expect(out).not.toContain(PII_TAIL); // …but the capped tail stays unserved
    expect(out).toMatch(/⚠ truncated: served 100 of \d+ chars/);
  });
});

describe('traceToolpack — security: redacted stays redacted', () => {
  it('the redacted sentinel appears in NO tool output, ever', async () => {
    const views = await allPassiveViews();
    const fetched = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'collect#0',
      key: 'ssn',
    });
    for (const view of [...views, fetched]) {
      expect(view).not.toContain(SSN_SENTINEL);
    }
  });

  it('redacted keys serve the placeholder verbatim and are flagged', async () => {
    const who = await callTraceTool(tools, 'who_wrote', { key: 'ssn' });
    expect(who).toContain('(redacted by policy)');
    expect(who).toMatch(/REDACTED/);

    const value = await callTraceTool(tools, 'get_value', {
      runtimeStageId: 'collect#0',
      key: 'ssn',
    });
    expect(value).toContain('(redacted by policy)');
    expect(value).toMatch(/REDACTED/);
  });

  it('find_in_trace searches the REDACTED log only — a scrubbed value is unfindable', async () => {
    // Searching for the scrubbed content finds nothing, because no copy of
    // it exists to search: footprintjs replaced it at commit time and the
    // toolpack has no other source. "Not found" here is the truth.
    const hunt = await callTraceTool(tools, 'find_in_trace', { query: SSN_SENTINEL });
    expect(hunt).toContain('no match');
    // Zero hit lines: the only place the sentinel appears is the caller's
    // own query echoed back, which came from the caller, not from the run.
    expect(hunt.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(0);
    expect(hunt).toContain('redaction removed'); // and it says WHY that can happen

    // Searching for the placeholder DOES find the key — the redaction is
    // visible as a fact about the run, which is the honest half of this.
    const placeholder = await callTraceTool(tools, 'find_in_trace', { query: 'REDACTED' });
    expect(placeholder).toContain('FOUND');
    expect(placeholder).toContain('(redacted by policy)');
    expect(placeholder).not.toContain(SSN_SENTINEL);
  });

  it('find_in_trace never serves more than a bounded window of a long value', async () => {
    const out = await callTraceTool(tools, 'find_in_trace', { query: PII_HEAD });
    expect(out).toContain('FOUND');
    expect(out).toContain(PII_HEAD); // the match itself is shown…
    expect(out).not.toContain(PII_TAIL); // …but never the whole value
    expect(out).not.toContain(PII_VALUE);
  });
});
