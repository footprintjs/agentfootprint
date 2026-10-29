// One adapter per parser: native output → the port's shape, faithfully (no extra word lists).
// Each returns { entities, native }: the mapped mentions, and the reader's own output for results/raw/.
//
//   entity: { span: {start,end}, text, kind, lookbackSeconds?, window?: {from,to} (ms), mods: [], ambiguous, native }
//   kind: 'lookback' (a window ending now, said as a length) | 'range' | 'point' | 'duration' (no anchor)
//         | 'recurrence' | 'unreadable'
//
// A window "ends now" when its end is within one minute of the reference clock (the corpus clock
// is on a whole minute, so a minute-grain interval ending at the clock counts; an hour-grain one
// that stops at the last whole hour does not — it is a different window).
import Recognizers from '@microsoft/recognizers-text-date-time';
import * as chrono from 'chrono-node';
import { englishTimeReader } from '../.build/af-english.mjs';

const MINUTE = 60_000;
const endsNow = (to, now) => Math.abs(to - now.getTime()) < MINUTE;
const UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 };

/** Drop an entity whose span lies inside another's (Duckling returns a duration inside a time). */
function maximal(entities) {
  return entities.filter((e, i) => !entities.some((o, j) => j !== i
    && o.span.start <= e.span.start && o.span.end >= e.span.end
    && (o.span.end - o.span.start > e.span.end - e.span.start || j < i)));
}

// ─── Recognizers-Text (DateTimeV2) ─────────────────────────────────────────────
const recDate = (s) => {
  if (typeof s !== 'string') return undefined;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return Date.parse(s.replace(' ', 'T') + 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + 'T00:00:00Z');
  return undefined;
};
export function recognizers(text, now) {
  const results = Recognizers.recognizeDateTime(text, Recognizers.Culture.English, Recognizers.DateTimeOptions.None, now);
  const native = results.map((r) => ({ start: r.start, end: r.end, text: r.text, typeName: r.typeName, resolution: r.resolution }));
  const entities = maximal(results.map((r) => {
    const values = r.resolution?.values ?? [];
    const v = values[0] ?? {};
    const type = r.typeName.replace('datetimeV2.', '');
    const mods = [...new Set(values.map((x) => x.Mod).filter(Boolean))];
    const e = {
      span: { start: r.start, end: r.end + 1 }, text: r.text, mods, ambiguous: values.length > 1,
      kind: type === 'set' ? 'recurrence' : type === 'duration' ? 'duration' : /range$/.test(type) ? 'range' : 'point',
      native: { type, values },
    };
    if (e.kind === 'range') {
      const from = recDate(v.start); const to = recDate(v.end);
      if (from !== undefined && to !== undefined) {
        e.window = { from, to };
        if (endsNow(to, now) && from < to) { e.kind = 'lookback'; e.lookbackSeconds = (to - from) / 1000; }
      }
    } else if (e.kind === 'duration' && v.value !== undefined) {
      e.durationSeconds = Number(v.value);
    } else if (e.kind === 'point') {
      const at = recDate(v.value);
      if (at !== undefined) e.at = at;
    }
    return e;
  }));
  return { entities, native };
}

// ─── chrono-node ───────────────────────────────────────────────────────────────
export function chronoNode(text, now) {
  const results = chrono.parse(text, { instant: now, timezone: 'UTC' }, { forwardDate: false });
  const entities = maximal(results.map((r) => {
    const from = r.start.date().getTime();
    const to = r.end?.date().getTime();
    const e = {
      span: { start: r.index, end: r.index + r.text.length }, text: r.text, mods: [], ambiguous: false,
      kind: to !== undefined ? 'range' : 'point',
      native: { start: new Date(from).toISOString(), end: to !== undefined ? new Date(to).toISOString() : undefined, tags: r.tags ? [...r.tags()] : [] },
    };
    if (to !== undefined) {
      e.window = { from, to };
      if (endsNow(to, now) && from < to) { e.kind = 'lookback'; e.lookbackSeconds = (to - from) / 1000; }
    } else {
      e.at = from;
    }
    return e;
  }));
  return { entities, native: entities.map((e) => ({ index: e.span.start, text: e.text, ...e.native })) };
}

// ─── Duckling (HTTP) ───────────────────────────────────────────────────────────
/** `recorded`: Duckling's answer recorded by an earlier run (results/raw/), replayed instead of a request. */
export async function duckling(text, now, recorded, url = process.env.DUCKLING_URL ?? 'http://127.0.0.1:18000/parse') {
  let raw = recorded;
  if (raw === undefined) {
    const body = new URLSearchParams({ locale: 'en_US', text, reftime: String(now.getTime()), tz: 'UTC' });
    const res = await fetch(url, { method: 'POST', body });
    if (!res.ok) throw new Error(`duckling ${res.status}`);
    raw = await res.json();
  }
  const entities = raw.filter((d) => (d.dim === 'time' || d.dim === 'duration') && d.latent !== true).map((d) => {
    const v = d.value;
    const e = {
      span: { start: d.start, end: d.end }, text: d.body, mods: [], ambiguous: (v.values?.length ?? 1) > 1,
      kind: 'point', native: { dim: d.dim, value: v },
    };
    if (d.dim === 'duration') {
      e.kind = 'duration'; e.durationSeconds = v.normalized?.value;
    } else if (v.type === 'interval') {
      const from = v.from ? Date.parse(v.from.value) : undefined;
      const to = v.to ? Date.parse(v.to.value) : undefined;
      e.kind = 'range';
      if (from === undefined) e.mods.push('before');
      if (to === undefined) e.mods.push('after');
      if (from !== undefined && to !== undefined) {
        e.window = { from, to };
        if (endsNow(to, now) && from < to) { e.kind = 'lookback'; e.lookbackSeconds = (to - from) / 1000; }
      } else {
        e.window = { from: from ?? -Infinity, to: to ?? Infinity };
      }
    } else {
      e.at = Date.parse(v.value);
      e.grain = v.grain;
    }
    return e;
  });
  return { entities: maximal(entities), raw };
}

// ─── The closed lookback grammar as a reader (a prototype of an extended englishTimeReader) ───
// Each head word (last, past, trailing, latest, most recent) starts a candidate; the LONGEST run of
// up to 8 following tokens the grammar reads is the mention. Nothing else is read: every other time
// word is left to the leftover scan, which asks.
import { tokenize, readLookbackQuote } from './signals.mjs';
const HEADS = new Set(['last', 'past', 'trailing', 'latest']);
export function libraryGrammar(text) {
  const tokens = tokenize(text);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const head = HEADS.has(tokens[i].word) ? i : (tokens[i].word === 'most' && tokens[i + 1]?.word === 'recent' ? i : -1);
    if (head < 0) continue;
    let best;
    for (let k = head + 1; k < Math.min(tokens.length, head + 10); k++) {
      const quote = text.slice(tokens[head].start, tokens[k].end);
      const seconds = readLookbackQuote(quote);
      if (seconds !== undefined) best = { k, seconds, quote };
    }
    if (best === undefined) continue;
    out.push({ span: { start: tokens[head].start, end: tokens[best.k].end }, text: best.quote, kind: 'lookback', lookbackSeconds: best.seconds, mods: [], ambiguous: false, native: { grammar: true } });
    i = best.k;
  }
  return { entities: out, native: out.map((e) => ({ span: [e.span.start, e.span.end], quote: e.text, seconds: e.lookbackSeconds })) };
}

// ─── agentfootprint englishTimeReader (bundled from the library's source) ──────
const reader = englishTimeReader();
export function afEnglish(text) {
  const { mentions } = reader.read(text, { locale: 'en-US' });
  let from = 0;
  const entities = mentions.map((m) => {
    const start = text.indexOf(m.quote, from);
    from = start + m.quote.length;
    const e = { span: { start, end: start + m.quote.length }, text: m.quote, mods: [], ambiguous: m.parses.length > 1, kind: 'point', native: m };
    if (m.problem === 'unreadable') { e.kind = 'unreadable'; return e; }
    const p = m.parses[0];
    if (p.relative?.count !== undefined && Object.keys(p).length === 1) {
      e.kind = 'lookback'; e.lookbackSeconds = p.relative.count * UNIT_SECONDS[p.relative.unit];
    } else if (p.rangeOf !== undefined) {
      e.kind = 'range';
    }
    return e;
  });
  return { entities, native: mentions };
}
