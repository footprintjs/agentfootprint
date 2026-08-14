/**
 * hosting/conformance/run — running the battery, and saying honestly how it
 * went.
 *
 * The runner owns exactly three decisions, and all three are about the ways a
 * case can NOT run:
 *
 *  1. the case is about an OPTIONAL port member this store does not implement
 *     → `'not-applicable'`, naming the member. Feature detection, which is the
 *     port's own rule applied to its own battery.
 *  2. the store implements it and cannot satisfy the case, and the harness said
 *     so by name → `'declared'`, carrying the reason. It is run ANYWAY, so a
 *     declaration that has quietly become untrue is visible rather than
 *     permanent.
 *  3. the case needs a harness hook nobody supplied and nobody declared →
 *     `'failed'`. This is the one that matters: an undeclared skip is a pass
 *     with the evidence removed, which is the same shape as every defect this
 *     suite exists to catch.
 */

import { sessionLifecycleConformance } from './cases.js';
import type {
  ConformanceKit,
  SessionLifecycleCase,
  SessionLifecycleOutcome,
  SessionLifecycleReport,
  SessionStoreHarness,
  SessionStoreMember,
} from './types.js';
import type { CheckpointEnvelope, SessionLifecycle } from '../types.js';

/** Unique enough that two runs against one shared backend cannot collide. */
let counter = 0;

function kitFor(harness: SessionStoreHarness): ConformanceKit {
  const run = `cnf-${Date.now().toString(36)}-${(++counter).toString(36)}`;
  let nth = 0;
  return {
    harness,
    id: (suffix) => `${run}-${(++nth).toString(36)}-${suffix}`,
    envelope: (text, principal, savedAt) => buildEnvelope(text, principal, savedAt),
  };
}

/**
 * A minimal, VALID stored conversation.
 *
 * Built here rather than through `toEnvelope` so `savedAt` is the caller's —
 * the paging case needs several conversations to share one timestamp, which is
 * the only way to make a listing's tie-break the thing under test.
 */
function buildEnvelope(text: string, principal?: string, savedAt?: number): CheckpointEnvelope {
  return {
    format: 'conversation-v1',
    savedAt: savedAt ?? 1_700_000_000_000,
    data: {
      version: 1,
      runId: `run-${text.replace(/\W+/g, '-')}`,
      history: [
        { role: 'user', content: text },
        { role: 'assistant', content: `re: ${text}` },
      ],
      lastCompletedIteration: 1,
      originalInput: { message: text },
      checkpointedAt: savedAt ?? 1_700_000_000_000,
      ...(principal !== undefined && { identity: { principal } }),
    },
  } as CheckpointEnvelope;
}

/** Is this member there to be called? The same detection every door uses. */
function has(store: SessionLifecycle, member: SessionStoreMember): boolean {
  return typeof (store as unknown as Record<string, unknown>)[member] === 'function';
}

/**
 * Run ONE case against one store, building and disposing the store around it.
 *
 * Exported because a test framework wants one assertion per case: iterate
 * {@link sessionLifecycleConformance}, call this, and turn the outcome into a
 * `it()`. That gives per-case granularity in any framework without this module
 * knowing what a framework is.
 */
export async function runSessionLifecycleCase(
  testCase: SessionLifecycleCase,
  harness: SessionStoreHarness,
): Promise<SessionLifecycleOutcome> {
  const head = { case: testCase.name, law: testCase.law } as const;
  const declaredReason = harness.declared?.[testCase.name];

  let store: SessionLifecycle | undefined;
  try {
    store = await harness.createStore();

    for (const member of testCase.members ?? []) {
      // Not applicable BEFORE declared: a store that does not implement
      // `ownerOf` at all has nothing to declare about it, and reporting a
      // declaration there would make the store look like it fell short of
      // something the port never asked it for.
      if (!has(store, member)) return { ...head, status: 'not-applicable', missing: member };
    }

    if (testCase.harnessNeeds?.includes('corrupt') && harness.corrupt === undefined) {
      if (declaredReason !== undefined) {
        return { ...head, status: 'declared', reason: declaredReason, stillFails: true };
      }
      return {
        ...head,
        status: 'failed',
        error: new Error(
          `[conformance] '${testCase.name}' needs harness.corrupt() and this harness has ` +
            `none — so the case did not run, and a case that did not run must never look ` +
            `like one that passed. Supply the hook, or DECLARE this case by name with the ` +
            `reason your store cannot be corrupted from outside:\n` +
            `  declared: { '${testCase.name}': 'why not' }`,
        ),
      };
    }

    await testCase.run(store, kitFor(harness));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // A declared case that still fails is the harness telling the truth.
    if (declaredReason !== undefined) {
      return { ...head, status: 'declared', reason: declaredReason, stillFails: true };
    }
    return { ...head, status: 'failed', error };
  } finally {
    if (store !== undefined) {
      try {
        await harness.disposeStore?.(store);
      } catch {
        /* A store that could not be torn down must not rewrite the verdict of
           the case that was using it — the case's own result is the finding. */
      }
    }
  }

  // It PASSED. If it was declared, the declaration is stale — worth saying,
  // because a suppression nobody revisits is how a fixed defect keeps its
  // exemption and a real one inherits it later.
  if (declaredReason !== undefined) {
    return { ...head, status: 'declared', reason: declaredReason, stillFails: false };
  }
  return { ...head, status: 'passed' };
}

/**
 * Run the whole battery against one store and report.
 *
 * @example  Claiming the port for a store of your own
 *   const report = await runSessionLifecycleConformance({
 *     name: 'ourOwnSessions',
 *     createStore: () => ourOwnSessions({ pool }),
 *     disposeStore: (store) => store.close(),
 *   });
 *   if (!report.ok) throw new Error(formatConformanceReport(report));
 */
export async function runSessionLifecycleConformance(
  harness: SessionStoreHarness,
): Promise<SessionLifecycleReport> {
  const outcomes: SessionLifecycleOutcome[] = [];
  for (const testCase of sessionLifecycleConformance) {
    outcomes.push(await runSessionLifecycleCase(testCase, harness));
  }
  const count = (status: SessionLifecycleOutcome['status']): number =>
    outcomes.filter((o) => o.status === status).length;
  const failed = count('failed');
  return {
    store: harness.name,
    outcomes,
    passed: count('passed'),
    notApplicable: count('not-applicable'),
    declared: count('declared'),
    failed,
    ok: failed === 0,
  };
}

/**
 * The report as something to put in a failure message or a log — one line per
 * case, with the reason a case did not simply pass.
 */
export function formatConformanceReport(report: SessionLifecycleReport): string {
  const lines = [
    `SessionLifecycle conformance — ${report.store}: ${report.passed} passed, ` +
      `${report.declared} declared, ${report.notApplicable} n/a, ${report.failed} FAILED`,
  ];
  for (const outcome of report.outcomes) {
    if (outcome.status === 'passed') {
      lines.push(`  ok        ${outcome.case}`);
    } else if (outcome.status === 'not-applicable') {
      lines.push(`  n/a       ${outcome.case} — no ${outcome.missing}() on this store`);
    } else if (outcome.status === 'declared') {
      lines.push(
        `  declared  ${outcome.case} — ${outcome.reason}` +
          (outcome.stillFails ? '' : '  [STALE: it passes now]'),
      );
    } else {
      lines.push(`  FAILED    ${outcome.case}`);
      lines.push(`            law: ${outcome.law}`);
      lines.push(`            ${outcome.error.message.split('\n').join('\n            ')}`);
    }
  }
  return lines.join('\n');
}
