/**
 * 85 — when a tool cannot read the person's window exactly: the library reads
 * MORE and says so, or refuses the call before it runs, with the reason.
 *
 * A look-back-only tool cannot read "yesterday" exactly — a look-back always
 * ends at now. The tool's period declares only FACTS:
 *
 *   period: { argument: 'window', spelling: 'lookback', direction: 'past', retention: '30d' }
 *
 *   - "yesterday" is only a PROPOSAL until the person confirms it (the owner's
 *     decision "Always confirm") — the look-back tool's `assume: '1h'` never
 *     stands in for it; the first call pauses on a one-click confirmation;
 *   - under `.time()`, when no form holds the person's window exactly, the
 *     library sends the first form that holds MORE — the covering look-back
 *     from now (`1960m` for all of yesterday), or the whole day for a `day`
 *     form — and records what it adds: the `call-window` row carries `sent`
 *     and `differs.extra` (or `trimmedByTool` when the tool declares
 *     `filtersToAsked`), and the model's note says the value reads a wider one.
 *     The call that ASKED is recorded the same way once the person confirms:
 *     its latest `call-window` row is `filled` from the person's answer;
 *   - when NO form can read the person's window, even wider — a covering
 *     look-back longer than the tool's `maxRange`, or a window still running —
 *     the call is refused (`no-form-holds`), never run on the tool's assumed
 *     `1h`, and the served line turns the refusal into what the answer states;
 *   - a call whose window the tool cannot honestly read is refused BEFORE it
 *     runs, and the model reads why: a window outside the tool's `direction`,
 *     wholly older than its `retention`, wider than its `maxRange`, spanning
 *     days for a `day`-only tool, or a wall time the zone's clocks skip; a
 *     window only PARTLY older than `retention` runs, marked;
 *   - a look-back the clock drifted past (after a pause) is redrawn as the
 *     asked range when the library wrote it and the tool takes an absolute
 *     form; the model's own look-back runs as sent and is recorded shifted;
 *   - an app that needs the same answer OUTSIDE a run (a preview of what a
 *     tool would read) asks the library's own conversion through
 *     `agentfootprint/time` — `convertExact`, `convertWidened`,
 *     `periodFactProblem` — and gets exactly what the run sent.
 *
 * Run:  npm run example examples/features/85-time-widen-and-refuse.ts
 */

import { Agent, defineTool, isInputPause, type TimeReader } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { convertExact, convertWidened, periodFactProblem } from '../../src/doors/time.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/85-time-widen-and-refuse',
  title: "Wider than asked, or refused — when a tool cannot read the person's window exactly",
  group: 'features',
  description:
    "When no form of a tool holds the person's window exactly, the library sends the first form " +
    'that holds more (a covering look-back, a whole day) and records what it adds; a call whose ' +
    "window breaks the tool's declared facts (direction, retention, maxRange, one day per call, a " +
    'skipped wall time) or that no form can read even wider is refused before it runs, with the ' +
    'reason.',
  defaultInput: 'Any backup errors yesterday? And what is scheduled tomorrow?',
  providerSlots: [],
  tags: ['features', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// A fixture reader: "yesterday" as a day word. The library, not the reader, turns it into a window.
const reader: TimeReader = {
  id: 'example/fixture',
  version: '1.0.0',
  locale: 'en-US',
  kind: 'rule',
  read: (text) =>
    text.includes('yesterday')
      ? { mentions: [{ quote: 'yesterday', parses: [{ relative: { unit: 'day', offset: -1 } }] }] }
      : { mentions: [] },
};

// #region widen-and-refuse
const handed: unknown[] = [];
const backupErrors = defineTool({
  name: 'backup_errors',
  description: 'Backup error lines over a look-back window ending now.',
  inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
  askOrAssume: { window: { assume: '1h' } },
  period: { argument: 'window', spelling: 'lookback', direction: 'past', retention: '30d' },
  execute: (args) => {
    handed.push(args);
    return '{"errors":0}';
  },
});

// A second tool reads an absolute range — and its source, a log store, holds no tomorrow.
const backupRuns = defineTool({
  name: 'backup_runs',
  description: 'Backup runs over an ISO range (from..to).',
  inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
  askOrAssume: { window: { ask: 'Over which window?' } },
  period: { argument: 'window', spelling: 'iso-range', direction: 'past' },
  execute: (args) => {
    handed.push(args);
    return '{"runs":3}';
  },
});

// The turn's clock, on a whole minute (a look-back is spelled in whole minutes).
const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const tomorrow = {
  from: new Date(now.getTime() + 86_400_000).toISOString(),
  to: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
};
const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  content: '',
  toolCalls: [{ id, name, args }],
});

const desk = Agent.create({
  provider: mock({
    replies: [
      // The model leaves the period out: the person is asked to confirm "yesterday" first.
      toolCall('c0', 'backup_errors', {}),
      // Again, later in the turn: the library fills the confirmed day — wider than asked.
      toolCall('c1', 'backup_errors', {}),
      // The model sends a window still to come to a tool whose source holds only the past.
      toolCall('c2', 'backup_runs', { window: `${tomorrow.from}..${tomorrow.to}` }),
      { content: 'No backup errors since the start of yesterday; tomorrow cannot be read yet.' },
    ],
  }),
  model: 'small-model',
})
  .tool(backupErrors)
  .tool(backupRuns)
  .time({ zone: 'America/Los_Angeles', reader })
  .build();
// #endregion widen-and-refuse

// #region no-form-holds
// The same look-back tool, but it reads at most one day at once: reaching the start of yesterday
// from now takes a longer look-back, so no form can read that window — the call is refused before
// anything is asked, and never runs on its assumed `1h`.
const shortSearch = defineTool({
  name: 'recent_errors',
  description: 'Error lines over a look-back window ending now, at most one day.',
  inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
  askOrAssume: { window: { assume: '1h' } },
  period: { argument: 'window', spelling: 'lookback', direction: 'past', maxRange: '24h' },
  execute: (args) => {
    handed.push(args);
    return '{"errors":0}';
  },
});
const shortDesk = Agent.create({
  provider: mock({
    replies: [
      toolCall('s1', 'recent_errors', {}),
      { content: 'That tool reads at most the last day; yesterday is out of its reach.' },
    ],
  }),
  model: 'small-model',
})
  .tool(shortSearch)
  .time({ zone: 'America/Los_Angeles', reader })
  .build();
// #endregion no-form-holds

type WindowRow = {
  kind: string;
  toolCallId?: string;
  how?: string;
  refused?: string;
  asked?: { from: string; to: string };
  sent?: { from: string; to: string };
};

// #region same-answer-outside-a-run
// The conversion the run asked, asked by the app for the same window and clock: no run, no
// record — what a preview of "what would this tool read?" shows, and it is what the run sent.
function previewOf(asked: { from: string; to: string }) {
  const lookback = [{ kind: 'lookback', argument: 'window', signed: false }] as const;
  const clock = { now: now.toISOString(), zone: 'America/Los_Angeles', granularityMs: 60_000 };
  return {
    exact: convertExact({ range: asked }, lookback, clock), // undefined: a look-back ends at now
    widened: convertWidened({ range: asked }, lookback, clock), // the covering look-back + extra
    breaks: periodFactProblem(asked, { direction: 'past', retention: '30d' }, clock.now),
  };
}
// #endregion same-answer-outside-a-run
/** A call's LATEST `call-window` row — the window it ran with (or why it did not run). */
const latest = (rows: readonly WindowRow[], id: string) =>
  rows.filter((r) => r.kind === 'call-window' && r.toolCallId === id).pop();

export async function run(input: string): Promise<string> {
  const asked = await desk.run({ message: input, time: { now: now.toISOString() } });
  check(isInputPause(asked), '"yesterday" offered to confirm');
  if (!isInputPause(asked)) return String(asked);
  const out = await desk.resume(asked.checkpoint, {
    requestId: asked.awaitingInput.requestId,
    values: { f1: asked.awaitingInput.fields[0]?.enum?.[0] as string },
  });
  console.log('the tool was handed:', JSON.stringify(handed));
  const rows = (desk.findings() ?? []) as readonly WindowRow[];
  console.log(
    '\ncall-window rows:',
    JSON.stringify(
      rows.filter((r) => r.kind === 'call-window'),
      null,
      2,
    ),
  );
  const asker = latest(rows, 'c0');
  check(asker?.how === 'filled' && 'differs' in asker, 'the asking call recorded wider');
  const later = latest(rows, 'c1');
  check(later?.how === 'filled' && 'differs' in later, 'the later fill recorded wider');
  check(latest(rows, 'c2')?.how === 'refused', 'the future window refused before it ran');
  check(handed.length === 2, 'only the confirmed and the widened call ran');

  // The app's preview of the same window — the library's own answer, not a copy.
  if (asker?.asked !== undefined) {
    const preview = previewOf(asker.asked);
    check(preview.exact === undefined, 'no look-back holds yesterday exactly');
    check(preview.breaks === undefined, 'yesterday breaks none of the tool facts');
    check(
      JSON.stringify(preview.widened?.values) === JSON.stringify(handed[0]),
      'the preview sends what the run sent',
    );
    check(
      JSON.stringify(preview.widened?.sent) === JSON.stringify(asker.sent),
      'the preview reads what the row says the tool read',
    );
    console.log('\nthe same answer outside a run:', JSON.stringify(preview.widened));
  } else {
    check(false, 'the asking call carries the asked range');
  }

  const short = await shortDesk.run({ message: input, time: { now: now.toISOString() } });
  const shortRows = (shortDesk.findings() ?? []) as readonly WindowRow[];
  check(!isInputPause(short), 'nothing asked: no reading of "yesterday" is readable');
  check(latest(shortRows, 's1')?.refused === 'no-form-holds', 'refused, not run on its 1h');
  check(handed.length === 2, 'the one-day tool never ran');
  console.log('\nthe one-day tool:', JSON.stringify(latest(shortRows, 's1')));
  return `${String(out)}\n${String(short)}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
