// Finite development grammar. A future form or phrase needs its own measurements.
export const processZones = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Asia/Kolkata'];
export const appZones = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata'];
export const anchors = [
  '2026-01-01T00:00:00Z', '2026-03-08T10:30:00Z', '2026-11-01T09:30:00Z',
  '2028-02-29T23:59:15.125Z',
];
const lookbacks = [
  ['last 2 hours', 120], ['past 2 hours', 120], ['last 2 hrs', 120],
  ['last 2h', 120], ['past 40 minutes', 40], ['last 1 minute', 1],
];
// UTC instants are explicit calendar fixtures, independent of the reader and Intl.
const ranges = [
  ['2026-03-08 1:30 AM to 3:30 AM America/Los_Angeles', '2026-03-08T09:30Z', '2026-03-08T10:30Z'],
  ['2026-11-01 12:30 AM to 2:30 AM America/Los_Angeles', '2026-11-01T07:30Z', '2026-11-01T10:30Z'],
  ['2026-11-13 14:00 to 16:15 Asia/Kolkata', '2026-11-13T08:30Z', '2026-11-13T10:45Z'],
  ['2026-11-13 2:00 PM to 4:15 PM UTC', '2026-11-13T14:00Z', '2026-11-13T16:15Z'],
  ['2026-12-31T23:45Z to 2027-01-01T00:15Z', '2026-12-31T23:45Z', '2027-01-01T00:15Z'],
];
export const controls = [
  'last 2 hours before the outage', 'yesterday in the last 2 hours', 'not the last 2 hours',
  'last 2 hours or last 1 minute', '2026-11-13 8:00 to 9:00 UTC', '03/04/2026 2 PM to 4 PM UTC',
  '2026-07-13 2 PM to 4 PM PST', '2026-11-13 2 PM to 4 PM Atlantis',
];
export const phrases = [
  ...lookbacks.map(([text, minutes]) => ({ form: 'lookback', text, minutes })),
  ...ranges.map(([text, from, to]) => ({ form: 'range', text, from, to })),
];
export const classifyPhrase = text => phrases.find(entry => entry.text === text)?.form;
export function cells(processZone) {
  const rows = [];
  for (const phrase of phrases) {
    for (const now of anchors) {
      for (const zone of appZones) {
        const from = new Date(phrase.from ?? Date.parse(now) - phrase.minutes * 60000).toISOString();
        const to = new Date(phrase.to ?? now).toISOString();
        rows.push({ id: [processZone, zone, now, phrase.text].join('|'), processZone, zone, now,
          text: phrase.text, form: phrase.form, expected: { from, to, end: 'exclusive',
            precision: phrase.form === 'range' ? 'minute' : now.includes('.') ? 'fraction' : 'second' } });
      }
    }
  }
  return rows;
}
