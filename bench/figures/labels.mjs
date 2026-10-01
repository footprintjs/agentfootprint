/**
 * bench/figures/labels.mjs — the labeller: which figures an answer states, and whether each is
 * in the record or derives from it. Deterministic, over the answer's text and the recorded
 * result — never a model, and never the library's own gate (the gate is what is measured, so
 * its rules are not reused here: the extractor and the derivations below are written
 * independently, from the record's meaning rather than its shape).
 */

/** A figure: a number with a size or percent unit, or any number written with a decimal point. */
const UNIT = String.raw`(?:%|\s?percent\b|\s?(?:[kmgtp]i?b|[kmgtp]bytes?)\b)`;
const FIGURE_RE = new RegExp(
  String.raw`(?<![\w.,/-])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d]|\.\d)(\s?${UNIT})?`,
  'gi',
);

/** Every figure the answer states: `{ value, decimals, text }`, in order. */
export function figuresIn(answer) {
  const out = [];
  for (const m of answer.matchAll(FIGURE_RE)) {
    const raw = m[1];
    const hasDecimal = raw.includes('.');
    if (!hasDecimal && m[2] === undefined) continue; // a whole number with no unit is a count
    const value = Number(raw.replace(/,/g, ''));
    const dot = raw.indexOf('.');
    out.push({ value, decimals: dot === -1 ? 0 : raw.length - dot - 1, text: m[0].trim() });
  }
  return out;
}

const TIB = 1e12 / 2 ** 40;

/**
 * The values an honest answer can state from `record` (the full capacity result): every
 * number in it, and what a person would work out from the pool rows — per pool and per
 * cluster: total, used, usable, hot spare, total − used, used %, free % (100 − used %),
 * usable %, and each TB figure in TiB and PB.
 */
export function allowedValues(record) {
  const out = new Set();
  const walk = (node) => {
    if (typeof node === 'number' && Number.isFinite(node)) out.add(node);
    else if (typeof node === 'string' && /^-?\d+(?:\.\d+)?$/.test(node)) out.add(Number(node));
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(record);
  const rows = record?.result?.rows ?? [];
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.cluster) ?? [];
    g.push(r);
    groups.set(r.cluster, g);
  }
  const sizes = [];
  const describe = (total, used, usable, spare) => {
    sizes.push(total, used, usable, spare, total - used);
    if (total > 0) {
      const pct = (100 * used) / total;
      out.add(pct).add(100 - pct).add((100 * usable) / total);
    }
  };
  for (const r of rows) describe(r.total_tb, r.used_tb, r.usable_tb, r.hot_spare_tb);
  for (const g of groups.values()) {
    const sum = (k) => g.reduce((a, r) => a + (r[k] ?? 0), 0);
    describe(sum('total_tb'), sum('used_tb'), sum('usable_tb'), sum('hot_spare_tb'));
  }
  for (const s of sizes) out.add(s).add(s * TIB).add(s / 1000);
  return [...out];
}

/** True when `f` is `a` as written: within half a unit of its last digit, or 0.5% of `a`. */
export function matches(f, a) {
  const tol = Math.max(0.5 * 10 ** -f.decimals, 0.005 * Math.abs(a));
  return Math.abs(f.value - a) <= tol + 1e-9;
}

/** Phrases that doubt or deflect the answer rather than state it. */
export const HEDGE_PATTERNS = Object.freeze([
  /\bcan(?:no|')t\b/i,
  /\bunable\b/i,
  /\b(?:do not|don't|doesn't|does not) (?:have|show|include|see|contain)\b/i,
  /\bnot (?:available|visible|shown|included|provided)\b/i,
  /\bnot sure\b/i,
  /\bData panel\b/i,
  /\bwithout (?:the|access)\b/i,
]);

/**
 * One answer, labelled. `invented` lists the figures matching no allowed value; `target`
 * (a control's planted figure) says whether the answer states it.
 */
export function labelAnswer(answer, record, target) {
  const allowed = allowedValues(record);
  const figures = figuresIn(answer);
  const invented = figures.filter((f) => !allowed.some((a) => matches(f, a))).map((f) => f.text);
  return {
    figures: figures.length,
    invented,
    hedged: HEDGE_PATTERNS.some((re) => re.test(answer)),
    ...(target !== undefined && {
      correct: figures.some((f) => matches(f, target) || matches(f, target / 1000)),
    }),
  };
}
