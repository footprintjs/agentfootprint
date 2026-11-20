import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AgentfootprintEvent } from '../../events/registry.js';
import type { TraceToolpackArtifacts } from '../types.js';
import { requiresTraceAdmission } from './disposition.js';

const fixture = new URL(
  '../../../test/trace-toolpack/fixtures/recording-14.3.1.json.gz',
  import.meta.url,
);
const saved = gunzipSync(readFileSync(fixture), { maxOutputLength: 256 * 1024 }).toString('utf8');

function recording() {
  return JSON.parse(saved) as TraceToolpackArtifacts & { events: AgentfootprintEvent[] };
}

const beforeTool = {
  at: 'tool',
  moment: 'before-tool',
  outcome: 'allow',
  changed: false,
};

describe('legacy result admission', () => {
  it('keeps the complete published 14.3.1 no-rule record unchanged', () => {
    expect(requiresTraceAdmission(recording())).toBe(false);
  });

  it.each(['start', 'middle', 'end'])('restricts a legacy log missing its %s', (part) => {
    const artifacts = recording();
    const commits = artifacts.snapshot.commitLog;
    commits.splice(part === 'start' ? 0 : part === 'middle' ? 5 : commits.length - 1, 1);
    expect(requiresTraceAdmission(artifacts)).toBe(true);
  });

  it('does not infer no rules from an empty final ledger when a rule event exists', () => {
    const artifacts = recording();
    artifacts.events.push({
      type: 'agentfootprint.middleware.decision',
      payload: beforeTool,
    } as AgentfootprintEvent);
    artifacts.snapshot.sharedState.middlewareDecisions = [];
    expect(requiresTraceAdmission(artifacts)).toBe(true);
  });

  it('restricts when an earlier ledger is missing from the final state', () => {
    const artifacts = recording();
    const first = artifacts.snapshot.commitLog[0]!;
    first.trace.push({ verb: 'set', path: 'middlewareDecisions' });
    first.overwrite.middlewareDecisions = [beforeTool];
    expect(requiresTraceAdmission(artifacts)).toBe(true);
  });

  it('restricts when a legacy result bracket cannot identify a unique occurrence', () => {
    const artifacts = recording();
    const firstEnd = artifacts.events.find(
      (event) => event.type === 'agentfootprint.stream.tool_end',
    );
    expect(firstEnd).toBeDefined();
    artifacts.events.push(firstEnd!);
    expect(requiresTraceAdmission(artifacts)).toBe(true);
  });

  it('restricts on a reported after-tool change using disposition metadata only', () => {
    const artifacts = recording();
    const first = artifacts.snapshot.commitLog[0]!;
    first.trace.push({ verb: 'set', path: 'middlewareDecisions' });
    first.overwrite.middlewareDecisions = [{ ...beforeTool, moment: 'after-tool', changed: true }];
    expect(requiresTraceAdmission(artifacts)).toBe(true);
  });
});
