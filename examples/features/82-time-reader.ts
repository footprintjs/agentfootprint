/**
 * 82 — the time reader: the person's words read into candidate windows, and recorded.
 *
 * "Show client activity 10/09/26 8 AM to 8:40 AM" — is that 9 October or
 * 10 September? A library that silently picks MDY answers a question nobody
 * asked. So the time layer splits reading in two:
 *
 *   Agent.create(...).time({ zone, reader, policy: { dateOrder, year } })
 *
 *   - YOUR reader (a `TimeReader`, no default) TOKENIZES: it returns the parts it
 *     sees — `10/09/26` is three numbers, the order undecided — and the verbatim
 *     quote. It never picks an order, a zone or an instant;
 *   - the library RESOLVES the parts against the run's clock into every candidate
 *     window (three date orders, am and pm for a bare `8:40`, both instants of a
 *     wall time the clocks go back through), each read to the end of its grain
 *     ("to 8:40" is `[08:00, 08:41)`);
 *   - the POLICY narrows them (`dateOrder: 'MDY'` → recorded); and whatever is
 *     left is only a PROPOSAL (the owner's decision "Always confirm"): no
 *     reading is filed as the person's words — the time ask offers it,
 *     pre-filled with its window and zone, and only the person's answer is theirs;
 *   - seed files one `time-reading` row per mention, once per turn, only on a
 *     message a person wrote — a resume or a retry reads the row, never the reader;
 *   - a `kind: 'model'` reader's window is never the person's words either.
 *
 * This example's reader is a FIXTURE that returns fixed parts; the library's
 * English reader is example 86.
 *
 * Run:  npm run example examples/features/82-time-reader.ts
 */

import { Agent, type TimeReader, type TimeReadingRow } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/82-time-reader',
  title: 'The time reader — the person’s words read into candidate windows, and recorded',
  group: 'features',
  description:
    'A reader armed with .time({ reader }) tokenizes the message into zone-less parts ("10/09/26" → ' +
    'three numbers, the order undecided); the library resolves every candidate window against the ' +
    'run clock, the policy (dateOrder, year) picks among them or leaves them open for the person, and ' +
    'seed files one time-reading row per mention — once per message, never re-read on a resume.',
  defaultInput: 'Show client activity 10/09/26 8 AM to 8:40 AM',
  providerSlots: [],
  tags: ['features', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region time-reader
/** A fixture reader: the parts a tokenizer returns for "10/09/26 8 AM to 8:40 AM". */
const fixtureReader: TimeReader = {
  id: 'example/fixture',
  version: '1.0.0',
  locale: 'en-US',
  kind: 'rule',
  read: (text) => {
    const quote = '10/09/26 8 AM to 8:40 AM';
    if (!text.includes(quote)) return { mentions: [] };
    return {
      mentions: [
        {
          quote,
          parses: [
            {
              date: { kind: 'numeric', fields: [10, 9, 26] }, // the ORDER is not the reader's to decide
              rangeOf: [
                { wall: { h: 8, meridiem: 'am' } },
                { wall: { h: 8, m: 40, meridiem: 'am' } },
              ],
            },
          ],
        },
      ],
    };
  },
};

function desk(policy?: { dateOrder: 'MDY' }) {
  return Agent.create({ provider: mock({ replies: [{ content: 'Done.' }] }), model: 'small-model' })
    .time({ zone: 'America/Los_Angeles', reader: fixtureReader, ...(policy && { policy }) })
    .build();
}
// #endregion time-reader

const readingOf = (agent: Agent): TimeReadingRow | undefined =>
  (agent.findings() ?? []).find((r) => r.kind === 'time-reading') as TimeReadingRow | undefined;

export async function run(input: string): Promise<string> {
  const time = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' };

  // 1. The default policy asks: three date orders, each a real window.
  const asking = desk();
  await asking.run({ message: input, time });
  const open = readingOf(asking);
  for (const c of open?.candidates ?? []) {
    console.log(`${c.reading.dateOrder}: ${c.range.from} → ${c.range.to}`);
  }
  console.log('choice:', JSON.stringify(open?.choice));
  check(open?.candidates?.length === 3, 'three candidate windows');
  check(open?.choice?.by === 'open', 'the order left open for the person');

  // 2. An app whose people write MDY declares it — the policy narrows to one reading,
  //    recorded; it is still a PROPOSAL the person confirms, never filed as their words.
  const mdy = desk({ dateOrder: 'MDY' });
  await mdy.run({ message: input, time });
  const assumed = readingOf(mdy);
  console.log('\nwith dateOrder MDY:', JSON.stringify(assumed?.choice));
  const choice = assumed?.choice;
  check(
    choice?.by === 'open' &&
      choice.remaining.length === 1 &&
      choice.open.includes('confirm') &&
      choice.policy?.dateOrder === 'MDY',
    'the policy narrowed to one reading, recorded — offered to confirm',
  );
  const window =
    choice?.by === 'open' ? assumed?.candidates?.[choice.remaining[0] as number] : undefined;
  check(window?.said.length === 0, 'the reading is not filed as the person’s words');
  check(
    window?.range.from === '2026-10-09T08:00:00-07:00' &&
      window.range.to === '2026-10-09T08:41:00-07:00',
    '"to 8:40" read to the end of its minute',
  );
  return `${window?.range.from} → ${window?.range.to} (${assumed?.reader.id} ${assumed?.reader.version}, tzdata ${assumed?.tzdata})`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
