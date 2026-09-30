/**
 * locales/timeAsk — the time ask's sentences, for the PERSON answering it
 * (time design § 6.2, TQ7).
 *
 * The library validates a time field's answer (`core/time/ask.ts` ·
 * `checkTimeAnswer`), so a refused answer needs a reason — and the reason is a
 * sentence a person reads on the re-ask (`InputRefusal.reason`), never text
 * for the model. It lives here, as data, so an app can translate or reword
 * every key: `.time({ messages: { 'answer.no-offset': '…' } })` overrides a
 * key, and the rest fall back to these. Placeholders are `{{name}}`:
 *
 * | Key | Placeholders |
 * |-----|--------------|
 * | `answer.not-an-instant`, `answer.no-offset`, `answer.not-a-range`, `answer.not-a-zone` | `value` — the answer as given (cut at 64 characters) |
 * | `answer.out-of-order` | `from`, `to` |
 * | `answer.dst-gap` | `value`, `wall` (the wall time as written), `zone` |
 * | `answer.time-future`, `answer.time-past` | `from`, `to` |
 * | `answer.beyond-retention` | `from`, `to`, `retention` (the source's, as declared) |
 * | `answer.over-max-range` | `from`, `to`, `maxRange` (the source's, as declared) |
 * | `ask.which`, `ask.confirm` | `quote` — the person's words the reading came from |
 * | `ask.zone` | `quote`, `token` — the zone they wrote |
 * | `choice.confirm` | `quote`, `window` — the label of the library's reading |
 *
 * Only a check the app armed can produce one of these: a field with a
 * `format`, or the choices of a reading under `.time()`.
 */

import type { TimeAskMessages } from '../core/time/ask.js';

/** The time ask's English sentences — one per `TIME_ASK_MESSAGE_KEYS` key. */
export const defaultTimeAskMessages: TimeAskMessages = Object.freeze({
  'answer.not-an-instant':
    '“{{value}}” is not a date and time. Write it with its offset, like 2026-10-09T08:00-07:00.',
  'answer.no-offset':
    '“{{value}}” has no offset, so it could be in any time zone. Add one, like -07:00, or Z for UTC.',
  'answer.not-a-range':
    '“{{value}}” is not a start and an end. Write both, joined by a slash, like 2026-10-09T08:00-07:00/2026-10-09T08:40-07:00.',
  'answer.out-of-order': 'The start {{from}} is not before the end {{to}}.',
  'answer.dst-gap':
    '{{wall}} does not exist in {{zone}}: the clocks skip that hour on that day. Pick a time before or after it.',
  'answer.not-a-zone': '“{{value}}” is not a time zone name. Name one such as America/Los_Angeles.',
  'answer.time-future':
    'That window has not happened yet: it starts at {{from}}, and this source holds only the past.',
  'answer.time-past':
    'That window is over: it ends at {{to}}, and this source holds only what is still to come.',
  'answer.beyond-retention':
    'That window is older than this source keeps ({{retention}}): nothing from {{from}} to {{to}} is still held.',
  'answer.over-max-range':
    'That window is wider than this source reads at once ({{maxRange}}). Pick a shorter one.',
  'ask.which': 'Which time did you mean by “{{quote}}”?',
  'ask.confirm': 'Is this the time you meant by “{{quote}}”?',
  'ask.zone': 'Which time zone did you mean by “{{token}}” in “{{quote}}”?',
  'choice.confirm': 'I read “{{quote}}” as {{window}} — is that right?',
});
