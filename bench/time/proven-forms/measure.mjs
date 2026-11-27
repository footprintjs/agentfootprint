import { englishTimeReader } from '../../../src/time/readers/english.ts';
import { resolveMention, chooseReading, DEFAULT_TIME_POLICY } from '../../../src/time/resolve.ts';
import { rulerRows } from '../../../test/time/fixtures/rulerTool.ts';
import { cells, classifyPhrase } from './manifest.mjs';

const reader = englishTimeReader();
// Date.parse rounds submilliseconds. Refuse to describe a nonzero submillisecond as an exact match.
function utc(text) {
  if (!text || /\.\d{3}\d*[1-9]\d*(?:Z|[+-]\d\d:\d\d)$/.test(text)) return null;
  return new Date(text).toISOString();
}
function measure(cell) {
  const { text, now, zone, expected } = cell;
  const observed = { id: cell.id, actual: null, pass: false };
  const reading = reader.read(text, { locale: 'en-US' });
  const [mention] = reading.mentions;
  if (classifyPhrase(text) !== cell.form || reading.mentions.length !== 1 || mention.quote !== text ||
      mention.problem || mention.parses.length !== 1) return { ...observed, reason: 'incomplete-or-ambiguous-reading', mentions: reading.mentions.map(m => ({ quote: m.quote, parses: m.parses.length, problem: m.problem })) };
  const resolution = resolveMention(mention.parses, { now, zone }, reader);
  const choice = chooseReading(resolution, DEFAULT_TIME_POLICY, reader.kind);
  if (choice.by !== 'only' || resolution.candidates.length !== 1 || resolution.unsupported.length ||
      resolution.needsZone) return { ...observed, reason: 'no-unique-resolution' };
  const candidate = resolution.candidates[0];
  const actual = { from: utc(candidate.range.from), to: utc(candidate.range.to), end: candidate.endpoint?.end,
    precision: candidate.endpoint?.precision, cutoff: utc(candidate.endpoint?.cutoff) };
  if (actual.from !== expected.from || actual.to !== expected.to || actual.cutoff !== expected.to ||
      actual.end !== expected.end || actual.precision !== expected.precision) {
    return { ...observed, actual, reason: 'bounds-or-endpoint' };
  }
  const rows = rulerRows(actual, actual.end);
  const first = Math.ceil(Date.parse(expected.from) / 60000);
  const stop = Math.ceil(Date.parse(expected.to) / 60000);
  const pass = rows.length === stop - first && rows.every((row, i) =>
    row === 'R-' + new Date((first + i) * 60000).toISOString().slice(0, 16) + 'Z');
  return { ...observed, actual, pass, minuteRows: rows.length };
}
const processZone = process.env.TZ;
console.log(JSON.stringify({ reader: { id: reader.id, version: reader.version, kind: reader.kind },
  node: process.version, tz: process.versions.tz, icu: process.versions.icu, processZone,
  rows: cells(processZone).map(measure) }));
