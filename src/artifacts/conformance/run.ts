/**
 * artifacts/conformance/run — running the battery, and saying honestly how it
 * went.
 *
 * The runner owns exactly three decisions, and all three are about the ways a
 * case can NOT run:
 *
 *  1. the case is about an OPTIONAL port member this store does not implement
 *     (`putStream` / `getStream`) → `'not-applicable'`, naming the member.
 *     Feature detection, which is the port's own rule applied to its own
 *     battery.
 *  2. the store implements it and cannot satisfy the case, and the harness said
 *     so by name → `'declared'`, carrying the reason. It is run ANYWAY, so a
 *     declaration that has quietly become untrue is visible rather than
 *     permanent.
 *  3. the case needs a harness hook nobody supplied and nobody declared →
 *     `'failed'`. This is the one that matters: an undeclared skip is a pass
 *     with the evidence removed, which is the same shape as every defect a
 *     conformance battery exists to catch.
 */

import { artifactStoreConformance } from './cases.js';
import type {
  ArtifactConformanceKit,
  ArtifactStoreCase,
  ArtifactStoreHarness,
  ArtifactStoreHarnessHook,
  ArtifactStoreMember,
  ArtifactStoreOutcome,
  ArtifactStoreReport,
} from './types.js';
import type { ArtifactScope, ArtifactStore } from '../types.js';

/** Unique enough that two runs against one shared backend cannot collide. */
let counter = 0;

/**
 * The kit one case gets, plus the stores it opened through it.
 *
 * A case that asks for a bounded store gets a SECOND store, and something has
 * to close it. The runner keeps the list and disposes it in the same `finally`
 * as the case's own store — a handle leaked by a failing case surfaces three
 * cases later as a confusing second failure.
 */
function kitFor(
  harness: ArtifactStoreHarness,
  opened: ArtifactStore[],
): { kit: ArtifactConformanceKit } {
  const token = `cnf-${Date.now().toString(36)}-${(++counter).toString(36)}`;
  let nth = 0;
  const kit: ArtifactConformanceKit = {
    harness,
    token,
    scope: (suffix) => ({ conversationId: `${token}-${(++nth).toString(36)}-${suffix}` }),
    now: async (store) => {
      // The port has no clock verb, and it does not need one: every mint
      // stamps `createdAt` from the store's own calendar. The probe is put
      // into its own scope and deleted, so it cannot be seen by a listing case
      // or counted by a budget.
      const scope: ArtifactScope = { conversationId: `${token}-clock-probe` };
      const { meta } = await store.put(scope, {
        kind: 'conformance/clock-probe',
        mediaType: 'text/plain',
        data: '.',
      });
      await store.delete(scope, meta.ref);
      return meta.createdAt;
    },
    // The two hook wrappers are reachable only from cases that named the hook
    // in `harnessNeeds`, which the runner checked before calling `run` — the
    // refusal below is the belt for a case that forgot to say so, and it names
    // the fix rather than throwing a TypeError from inside a store.
    advance: async (store, ms) => {
      if (harness.advanceTime === undefined) throw missingHook('advanceTime');
      await harness.advanceTime(store, ms);
    },
    corrupt: async (store, scope, ref) => {
      if (harness.corrupt === undefined) throw missingHook('corrupt');
      await harness.corrupt(store, scope, ref);
    },
    bounded: async (maxBytesPerScope) => {
      if (harness.boundedStore === undefined) throw missingHook('boundedStore');
      const store = await harness.boundedStore(maxBytesPerScope);
      opened.push(store);
      return store;
    },
  };
  return { kit };
}

function missingHook(hook: ArtifactStoreHarnessHook): Error {
  return new Error(
    `[conformance] a case reached for harness.${hook}() without listing it in its own ` +
      `\`harnessNeeds\`, so the runner could not check for it up front. Add ` +
      `\`harnessNeeds: ['${hook}']\` to the case.`,
  );
}

/** Is this member there to be called? The same detection every consumer uses. */
function has(store: ArtifactStore, member: ArtifactStoreMember): boolean {
  return typeof (store as unknown as Record<string, unknown>)[member] === 'function';
}

/** What a harness has to add to run a case it currently cannot. */
const HOOK_HELP: Record<ArtifactStoreHarnessHook, string> = {
  advanceTime: 'move this store’s clock forward (an injected clock is one line)',
  corrupt: 'replace one artifact’s stored payload behind the store’s back',
  boundedStore: 'build a store whose per-scope byte budget is the number given',
};

/**
 * Run ONE case against one store, building and disposing the store around it.
 *
 * Exported because a test framework wants one assertion per case: iterate
 * {@link artifactStoreConformance}, call this, and turn the outcome into an
 * `it()`. That gives per-case granularity in any framework without this module
 * knowing what a framework is.
 */
export async function runArtifactStoreCase(
  testCase: ArtifactStoreCase,
  harness: ArtifactStoreHarness,
): Promise<ArtifactStoreOutcome> {
  const head = { case: testCase.name, law: testCase.law } as const;
  const declaredReason = harness.declared?.[testCase.name];
  const opened: ArtifactStore[] = [];

  let store: ArtifactStore | undefined;
  try {
    store = await harness.createStore();

    for (const member of testCase.members ?? []) {
      // Not applicable BEFORE declared: a store that does not implement
      // `getStream` at all has nothing to declare about it, and reporting a
      // declaration there would make the store look like it fell short of
      // something the port never asked it for.
      if (!has(store, member)) return { ...head, status: 'not-applicable', missing: member };
    }

    for (const hook of testCase.harnessNeeds ?? []) {
      if (harness[hook] !== undefined) continue;
      if (declaredReason !== undefined) {
        return { ...head, status: 'declared', reason: declaredReason, stillFails: true };
      }
      return {
        ...head,
        status: 'failed',
        error: new Error(
          `[conformance] '${testCase.name}' needs harness.${hook}() and this harness has ` +
            `none — so the case did not run, and a case that did not run must never look ` +
            `like one that passed. Supply the hook (${HOOK_HELP[hook]}), or DECLARE this ` +
            `case by name with the reason your store cannot:\n` +
            `  declared: { '${testCase.name}': 'why not' }`,
        ),
      };
    }

    const { kit } = kitFor(harness, opened);
    await testCase.run(store, kit);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // A declared case that still fails is the harness telling the truth.
    if (declaredReason !== undefined) {
      return { ...head, status: 'declared', reason: declaredReason, stillFails: true };
    }
    return { ...head, status: 'failed', error };
  } finally {
    for (const extra of [...opened, ...(store === undefined ? [] : [store])]) {
      try {
        await harness.disposeStore?.(extra);
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
 *   const report = await runArtifactStoreConformance({
 *     name: 'ourOwnArtifacts',
 *     createStore: () => ourOwnArtifacts({ bucket }),
 *     disposeStore: (store) => store.close(),
 *   });
 *   if (!report.ok) throw new Error(formatArtifactStoreReport(report));
 */
export async function runArtifactStoreConformance(
  harness: ArtifactStoreHarness,
): Promise<ArtifactStoreReport> {
  const outcomes: ArtifactStoreOutcome[] = [];
  for (const testCase of artifactStoreConformance) {
    outcomes.push(await runArtifactStoreCase(testCase, harness));
  }
  const count = (status: ArtifactStoreOutcome['status']): number =>
    outcomes.filter((outcome) => outcome.status === status).length;
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
export function formatArtifactStoreReport(report: ArtifactStoreReport): string {
  const lines = [
    `ArtifactStore conformance — ${report.store}: ${report.passed} passed, ` +
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
