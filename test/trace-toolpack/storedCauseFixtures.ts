import { flowChart, FlowChartExecutor, type RuntimeSnapshot } from 'footprintjs';
import { controlDepRecorder, readStoredCapture } from 'footprintjs/trace';
import { memorySink } from 'foottrace/write';

interface FixtureState {
  quote?: number;
  decision?: number;
  preparation?: number;
  [key: string]: unknown;
}

export interface StoredFixtureOptions {
  readonly readSources?: boolean;
  readonly missing?: boolean;
  readonly readOnlyMissing?: boolean;
  readonly readTracking?: 'full' | 'off';
  readonly withoutControl?: boolean;
  readonly fail?: boolean;
  readonly capture?: boolean;
  /** Two healthy steps with no retry configuration. */
  readonly plain?: boolean;
}

/** Real producer + sink + explicit host acknowledgement; no protocol validator is mocked. */
export async function storedCauseFixture(options: StoredFixtureOptions = {}): Promise<{
  readonly entries: unknown[];
  readonly runId: string;
  readonly snapshot: RuntimeSnapshot;
}> {
  let attempts = 0;
  const chart = flowChart<FixtureState>(
    'Recover',
    (scope) => {
      if (!options.plain && ++attempts === 1) throw Error('PRIVATE_CAPTURE_FIXTURE_ERROR');
      scope.quote = 4;
    },
    'quote',
  );
  if (!options.plain) chart.retry({ attempts: 2 });
  chart.addFunction(
    'Choose',
    (scope) => {
      scope.decision = scope.quote;
    },
    'choose',
  );
  if (!options.plain) {
    chart.addFunction(
      'Prepare',
      (scope) => {
        scope.preparation = scope.decision;
        if (options.fail) throw Error('PRIVATE_CAPTURE_FIXTURE_ERROR');
      },
      'prepare',
    );
  }
  if (options.missing) {
    chart.addFunction(
      'Missing',
      (scope) => {
        void scope['a.b'];
        void scope['a/b'];
        void scope['0'];
        scope.probe = 1;
        scope.unset = undefined;
      },
      'missing',
    );
  }
  if (options.readOnlyMissing) {
    for (const [index, key] of ['a.b', 'a/b', '0'].entries())
      chart.addFunction(
        `Read missing ${index}`,
        (scope) => {
          void scope[key];
        },
        `missing-read-${index}`,
      );
  }
  const adapter = memorySink();
  const capture = options.capture !== false;
  const executor = new FlowChartExecutor(chart.build(), {
    captureCoverage: capture,
    readTracking: options.readTracking ?? 'full',
    writeTracking: 'full',
    writeProvenance: 'reads-prefix',
    ...(options.readSources ? { readSources: true } : {}),
    sink: capture
      ? {
          adapter,
          capture: {
            acknowledge: async (target) => ({ ...target, durability: 'durable' as const }),
          },
        }
      : adapter,
  });
  if (!options.withoutControl)
    executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: capture }));
  try {
    await executor.run();
  } catch (error) {
    if (!options.fail) throw error;
  }
  const snapshot = executor.getSnapshot();
  return {
    entries: JSON.parse(JSON.stringify(adapter.entries)) as unknown[],
    runId: snapshot.runId,
    snapshot,
  };
}

export function noteData(entries: unknown[], note: string): Record<string, unknown> {
  const entry = entries.find(
    (value) =>
      (value as { kind?: string; note?: string }).kind === 'note' &&
      (value as { note?: string }).note === note,
  ) as { data: Record<string, unknown> } | undefined;
  if (!entry) throw Error('fixture note missing');
  return entry.data;
}

export async function requireStoredHistory(entries: unknown[], runId: string) {
  const result = await readStoredCapture(entries, { runId });
  if (result.status !== 'acknowledged') throw Error('fixture history was not acknowledged');
  return result.history;
}

/**
 * Test-only unkeyed checksum reconstruction for an edited packet. This deliberately
 * demonstrates corruption checking is not authentication; it is not a wire validator.
 */
export async function rehashStoredFixture(
  entries: unknown[],
  history: Awaited<ReturnType<typeof requireStoredHistory>>,
): Promise<void> {
  const payload = noteData(entries, 'capture-history');
  const evidence: Record<string, unknown> = {
    capture: payload.capture,
    executionTree: payload.executionTree,
  };
  for (const key of ['recorders', 'readSources', 'absent'])
    if (payload[key] !== undefined) evidence[key] = payload[key];
  const record = {
    commitLog: history.commitLog,
    ...(history.initialState === undefined ? {} : { initialState: history.initialState }),
  };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ evidence, record })),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  (payload.target as Record<string, unknown>).digest = hex;
  noteData(entries, 'capture-receipt').digest = hex;
}
