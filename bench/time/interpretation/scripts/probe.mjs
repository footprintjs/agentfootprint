// Probe: print each parser's NATIVE output for a few phrases (run with TZ=UTC).
// Usage: TZ=UTC node scripts/probe.mjs "phrase one" "phrase two" ...
import Recognizers from '@microsoft/recognizers-text-date-time';
import * as chrono from 'chrono-node';

const NOW = new Date('2026-10-27T09:30:00Z');
const DUCKLING = process.env.DUCKLING_URL ?? 'http://127.0.0.1:18000/parse';

async function duckling(text) {
  const body = new URLSearchParams({ locale: 'en_US', text, reftime: String(NOW.getTime()), tz: 'UTC' });
  const res = await fetch(DUCKLING, { method: 'POST', body });
  return res.json();
}

for (const text of process.argv.slice(2)) {
  console.log('\n=== ' + JSON.stringify(text));
  const rec = Recognizers.recognizeDateTime(text, Recognizers.Culture.English, Recognizers.DateTimeOptions.None, NOW);
  console.log('recognizers:', JSON.stringify(rec.map((r) => ({ s: r.start, e: r.end, text: r.text, type: r.typeName, values: r.resolution?.values }))));
  const ch = chrono.parse(text, { instant: NOW, timezone: 'UTC' }, { forwardDate: false });
  console.log('chrono:', JSON.stringify(ch.map((r) => ({ index: r.index, text: r.text, start: r.start?.date()?.toISOString(), end: r.end?.date()?.toISOString(), known: r.start?.knownValues, tags: r.tags ? [...r.tags()] : undefined }))));
  const du = await duckling(text);
  console.log('duckling:', JSON.stringify(du.map((d) => ({ s: d.start, e: d.end, body: d.body, dim: d.dim, latent: d.latent, value: d.value }))));
}
