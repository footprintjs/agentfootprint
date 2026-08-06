/**
 * 20 — Record a run, save it, render it in BOTH UIs.
 *
 * "I have a run. Show it in the UIs." Two steps: record it, then render it.
 *
 * A recording is exactly THREE things, and each one lights a different
 * surface:
 *
 *   events     the typed agentfootprint stream, in order  → the story,
 *              the commentary, the summary
 *   snapshot   the footprintjs run snapshot               → state, the
 *              commit axis, provenance, every recorder's data
 *   structure  the agent's build-time chart               → THE CHART.
 *              Nothing else can draw it.
 *
 * Miss one and one surface goes dark. That is the whole reason
 * `recordRun()` exists: every integration that assembled this bundle by
 * hand assembled a different, incomplete one — and the piece most often
 * missing was `structure`, because a finished run does not leave it
 * behind.
 *
 * This example does the round trip for real: it runs a two-step pipeline,
 * writes the recording to a file, reads it back off disk, and then CHECKS
 * the file against what each viewer needs — so the path is executable and
 * CI-verified rather than prose. It exits non-zero if a surface would go
 * dark. No React here (this is a Node script); the exact JSX for both
 * viewers is printed at the end.
 *
 * Offline + deterministic: mock provider, no API key, no network.
 *
 * Run:  npx tsx examples/observability/20-record-and-render.ts
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { metrics, narrative } from 'footprintjs/recorders';

import { LLMCall, Sequence } from '../../src/index.js';
import { recordRun } from '../../src/doors/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'observability/20-record-and-render',
  title: 'Record a run, save it, render it in both UIs',
  group: 'observability',
  description:
    'recordRun() saves a run as the three fields a viewer needs — snapshot, events, structure — ' +
    'writes them to disk, reads them back, and checks the file against what Lens and ' +
    'ExplainableShell each read, naming any surface that would go dark.',
  defaultInput: 'my invoice has an error',
  providerSlots: [],
  tags: ['observability', 'recording', 'replay', 'lens', 'explainable-ui', 'round-trip'],
};

// ─── What each viewer reads out of a recording ─────────────────────────────

/** One surface of one viewer, and the field it goes dark without. */
interface SurfaceCheck {
  readonly viewer: string;
  readonly surface: string;
  readonly needs: string;
  /** True when the recording on disk can drive this surface. */
  readonly ok: boolean;
  /** What the viewer shows when it can't. */
  readonly whenMissing: string;
  /**
   * Whether a complete recording MUST light this.
   *
   * The four required ones are the recording itself — the three fields and
   * the commit axis. The rest depend on which recorders the consumer chose
   * to attach (and on the engine shipping a snapshot bundle for them), so
   * they are reported, not enforced.
   */
  readonly required: boolean;
}

/** The recording as it comes back off disk — read defensively, it is JSON. */
interface RecordingOnDisk {
  readonly snapshot?: {
    readonly commitLog?: unknown[];
    readonly recorders?: { readonly name?: string; readonly data?: unknown }[];
  };
  readonly events?: unknown[];
  readonly structure?: unknown;
}

/** The boundary bundle's events, with only the field the strip is indexed by. */
interface BoundaryRow {
  readonly type?: string;
  readonly commitIdxBefore?: number;
}

function inspect(rec: RecordingOnDisk): SurfaceCheck[] {
  const recorders = rec.snapshot?.recorders ?? [];
  const byName = (name: string) => recorders.find((r) => r.name === name);

  const boundary = byName('BoundaryEvents');
  const rows = Array.isArray(boundary?.data) ? (boundary.data as BoundaryRow[]) : [];
  const opens = rows.filter((e) => e.type === 'subflow.entry' || e.type === 'run.entry');
  // The step strip is indexed by WHERE each boundary sits on the commit
  // axis. All-zero indices mean the run was recorded without commit
  // tracking: every boundary claims the same instant, and no viewer can
  // repair that — the commit log records what stages WROTE, never when a
  // boundary was crossed.
  const distinctPositions = new Set(opens.map((e) => e.commitIdxBefore)).size;

  return [
    {
      viewer: 'both',
      surface: 'the chart',
      needs: 'structure',
      ok: rec.structure !== undefined && rec.structure !== null,
      whenMissing: 'Lens returns runner: undefined and falls back; the shell omits the chart region',
      required: true,
    },
    {
      viewer: 'ExplainableShell',
      surface: 'memory + provenance + commit axis',
      needs: 'snapshot.commitLog',
      ok: (rec.snapshot?.commitLog?.length ?? 0) > 0,
      whenMissing: 'no state, no WhereFrom, no time axis',
      required: true,
    },
    {
      viewer: 'Lens',
      surface: 'the story / commentary',
      needs: 'events',
      ok: (rec.events?.length ?? 0) > 0,
      whenMissing: 'an empty log — the timeline has nothing to say',
      required: true,
    },
    {
      viewer: 'Lens',
      surface: 'the step strip',
      needs: 'a commit-tracking boundary recorder',
      ok: distinctPositions > 1,
      whenMissing: 'boundaryRanges === 0 — the strip stays quiet rather than inventing stops',
      required: true,
    },
    {
      viewer: 'ExplainableShell',
      surface: 'the Story panel',
      needs: 'narrative() on the snapshot',
      ok: byName('Narrative') !== undefined,
      // Attached here, and still absent on an older engine: the narrative
      // recorder only started riding the snapshot in footprintjs 9.12. A
      // recorder you attached that leaves no bundle is worth saying out
      // loud — otherwise the panel is just mysteriously generic.
      whenMissing:
        'generic lines — "X executed. Wrote: y". Attached but no bundle? ' +
        'the engine predates narrative-on-the-snapshot (footprintjs 9.12+)',
      required: false,
    },
    {
      viewer: 'ExplainableShell',
      surface: 'the Gantt’s real durations',
      needs: 'metrics() on the snapshot',
      ok: byName('Metrics') !== undefined,
      whenMissing: 'execution ORDER instead of timing — and it says so',
      required: false,
    },
  ];
}

// ─── The example ───────────────────────────────────────────────────────────

export async function run(
  input: string = 'my invoice has an error',
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  const classify = LLMCall.create({
    provider: provider ?? exampleProvider('core-flow', { reply: 'billing' }),
    model: 'mock',
  })
    .system('Classify the user intent as one word: billing, tech, or general.')
    .build();

  const respond = LLMCall.create({
    provider: provider ?? exampleProvider('core-flow', { reply: 'Routing you to billing.' }),
    model: 'mock',
  })
    .system('You are a support dispatcher. Write a short acknowledgement.')
    .build();

  const pipeline = Sequence.create({ name: 'IntakePipeline' })
    .step('classify', classify)
    .pipeVia((label) => ({ message: `Intent: ${label.trim()}` }))
    .step('respond', respond)
    .build();

  // ── STEP 1 — RECORD ──────────────────────────────────────────────────
  // These two are the consumer's choice, and each lights one panel. They
  // are not attached for you: a recording shouldn't pay for panels most
  // runs never open.
  // #region record
  pipeline.attach(narrative());
  pipeline.attach(metrics());

  const recorder = recordRun(pipeline); // BEFORE the run — see below
  const reply = await pipeline.run({ message: input });

  const recording = recorder.toRecording(); // { snapshot, events, structure }
  recorder.stop();
  // #endregion record

  // Why "before the run": the event stream is DROPPED, not queued, when
  // nothing is listening; the boundary channel only fires live; and the
  // chart lives on the spec, not on any artifact the run leaves behind.

  // ── The round trip: to disk and back ─────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), 'af-recording-'));
  const file = join(dir, 'run.json');
  try {
    writeFileSync(file, JSON.stringify(recording));
    const reloaded = JSON.parse(readFileSync(file, 'utf8')) as RecordingOnDisk;

    const sizeKb = (readFileSync(file).byteLength / 1024).toFixed(1);
    console.log(`\nReply: ${String(reply).trim()}`);
    console.log(`Recording: ${sizeKb} KB — ${recorder.eventCount} events, saved to run.json\n`);

    // ── STEP 2 — what the file can drive ───────────────────────────────
    const checks = inspect(reloaded);
    console.log('What this recording can show:\n');
    for (const c of checks) {
      const mark = c.ok ? '✓' : '✗';
      console.log(`  ${mark} ${c.viewer.padEnd(17)} ${c.surface}`);
      console.log(`      needs ${c.needs}${c.ok ? '' : ` — without it: ${c.whenMissing}`}`);
    }

    const dark = checks.filter((c) => !c.ok);
    const missingCore = dark.filter((c) => c.required);
    if (missingCore.length > 0) {
      // A viewer degrades honestly rather than breaking — but in an example
      // whose whole point is a complete recording, a missing CORE field is
      // a bug, so fail loudly here and let CI catch it.
      throw new Error(
        `This recording would leave ${missingCore.length} core surface(s) dark: ` +
          missingCore.map((c) => `${c.surface} (needs ${c.needs})`).join(', '),
      );
    }

    console.log('\nEvery core surface is lit. Render it — nothing re-runs, no model is called:\n');
    console.log(`  // Lens (the agent view)
  const { recorder, runner, boundaryRanges } = observeRecording(
    JSON.parse(await fs.readFile('run.json', 'utf8')),
  );
  <Lens recorder={recorder} runner={runner} theme={{ mode: 'light' }} />

  // Explainable UI (the pipeline view)
  const rec = JSON.parse(await fs.readFile('run.json', 'utf8'));
  <ExplainableShell
    runtimeSnapshot={rec.snapshot}
    traceGraph={structureGraphFromSpec(rec.structure)}
    runtimeOverlay={overlayFromSnapshot(rec.snapshot)}
    traceTheme={{ mode: 'light' }}
  />`);

    return {
      reply: String(reply).trim(),
      events: recorder.eventCount,
      commits: reloaded.snapshot?.commitLog?.length ?? 0,
      hasStructure: reloaded.structure !== undefined,
      surfacesLit: checks.length - dark.length,
      surfacesDark: dark.length,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
