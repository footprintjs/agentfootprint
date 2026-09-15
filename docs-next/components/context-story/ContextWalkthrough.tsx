'use client';

// The JSON view of the answer-building story, read off a RECORDED run.
//
// `scripts/gen-context-walkthrough.mjs` records the run at build time and
// pins which milestone stop each of the seven steps stands on; this
// component lazy-loads that recording and agentfootprint-lens's
// `<ContextView>` (the context object at a stop: who wrote each key, what
// moved, what was served) and hands it the ONE cursor for the step. Nothing
// here is hand-written context — regenerate the recording and the page
// follows the library.
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';

type Loaded = {
  readonly ContextView: ComponentType<{
    runner: unknown;
    cursor?: unknown;
    events?: readonly unknown[];
    initialMode?: 'keys' | 'json';
  }>;
  readonly runner: unknown;
  readonly events: readonly unknown[];
  readonly positions: readonly { label: string }[];
  readonly stops: Readonly<Record<string, number>>;
  readonly cursorAt: (step: number) => unknown;
};

let loading: Promise<Loaded> | undefined;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const [{ ContextView, CONTEXT_MILESTONE_AXIS }, core, data] = await Promise.all([
      import('agentfootprint-lens/context'),
      import('agentfootprint-lens/core'),
      import('@/lib/generated/context-walkthrough.json'),
    ]);
    const bundle = (data as { default?: unknown }).default ?? data;
    const { recording, stops } = bundle as { recording: unknown; stops: Record<string, number> };
    const observed = core.observeRecording(recording as never);
    const positions = core.tagAxisPositions(
      (recording as { snapshot: unknown }).snapshot,
      CONTEXT_MILESTONE_AXIS,
      [],
    ) ?? [];
    return {
      ContextView: ContextView as Loaded['ContextView'],
      runner: observed.runner ?? (recording as { snapshot: unknown }).snapshot,
      events: observed.recorder.getEntries(),
      positions,
      stops,
      cursorAt: (step: number) => core.lensCursorFrom(positions, step, () => undefined),
    };
  })();
  return loading;
}

export function ContextWalkthrough({ stepId, label }: { readonly stepId: string; readonly label: string }) {
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    load().then(
      (l) => alive && setLoaded(l),
      (e: unknown) => alive && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (failed !== undefined) {
    return (
      <div className="cx-json-panel">
        <div className="cx-caption">Recorded run · not available</div>
        <p>{failed}</p>
      </div>
    );
  }
  if (loaded === undefined) {
    return (
      <div className="cx-json-panel" aria-busy="true">
        <div className="cx-caption">Recorded run · loading</div>
      </div>
    );
  }
  const step = loaded.stops[stepId];
  if (step === undefined) {
    return (
      <div className="cx-json-panel">
        <div className="cx-caption">Recorded run · this step has no stop on the recording</div>
      </div>
    );
  }
  const { ContextView } = loaded;
  return (
    <div className="cx-json-panel cx-recorded">
      <div className="cx-caption">
        Context at this step · {label} · stop {step + 1} of {loaded.positions.length} · {loaded.positions[step]?.label}
      </div>
      <ContextView runner={loaded.runner} cursor={loaded.cursorAt(step)} events={loaded.events} />
      <p>Recorded on a deterministic mock provider at build time — no live model. Every value above is read from the run’s own record.</p>
    </div>
  );
}
