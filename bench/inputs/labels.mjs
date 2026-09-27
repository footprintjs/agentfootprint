/**
 * bench/inputs/labels.mjs — the blind hand labels, and how far the bench's text reader agrees
 * with them.
 *
 * The protocol (honesty design § 6.1): verdicts that need a reader's judgement come from blind
 * hand labels. The bench has ONE such verdict — which period an answer says it covers — and it
 * reads it mechanically (`metrics.mjs` · `statedDurations`, declared phrases matched as tokens).
 * This file hands a person the answers with the arm, the case id and the run hidden, in a seeded
 * shuffled order, and measures how often the mechanical reading and the person's label agree.
 * A rule clause that rests on the reader counts only when that agreement clears the bar in
 * `RULE.md`.
 *
 * The sheet (`blind-sheet.json`) is what the labeller opens; the key (`blind-key.json`) maps each
 * sheet id back to its run and is not opened until the labels are in.
 */

/** Seeded PRNG (mulberry32): the same seed always gives the same order. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with `prng(seed)` — a copy, never the input. */
export function shuffled(items, seed) {
  const out = [...items];
  const next = prng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The label values a person may give for "which period does this answer say it covers". */
export const WINDOW_LABELS = Object.freeze(['none', 'h1', 'h2', 'h6', 'd1', 'd7', 'several']);

/**
 * The blind sheet and its key, from raw runs (`harness.mjs` · `runCase`). Only answered runs
 * appear. Each sheet row shows the person's messages and the answer — nothing that names the
 * arm, the case or the run — with an empty label to fill.
 */
export function blindSheet(raws, seed) {
  const answered = raws.filter((r) => typeof r.turns[r.turns.length - 1]?.answer === 'string');
  const order = shuffled(answered, seed);
  const sheet = [];
  const key = {};
  order.forEach((raw, i) => {
    const id = `A${String(i + 1).padStart(3, '0')}`;
    sheet.push({
      id,
      messages: raw.turns.map((t) => t.message),
      answer: raw.turns[raw.turns.length - 1].answer,
      label: { window: null },
    });
    key[id] = raw.key;
  });
  return {
    sheet: {
      instructions:
        'For each answer, set label.window to the period the answer SAYS it covers: ' +
        `${WINDOW_LABELS.join(' | ')} ` +
        '(h1 = one hour, h2 = two hours, h6 = six hours, d1 = one day, d7 = seven days; ' +
        '"several" when it names more than one; "none" when it names no period). ' +
        'Judge only what the answer says, not whether it is right.',
      rows: sheet,
    },
    key,
  };
}

/**
 * Agreement between the mechanical reading and the hand labels: over every labelled row, the
 * share whose label equals the reader's (`none` for no duration, the one duration, or `several`).
 * `rows` are `metrics.mjs` · `readRun` rows; unlabelled sheet rows are skipped and counted.
 */
export function labelAgreement(sheet, key, rows) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let labelled = 0;
  let agree = 0;
  let skipped = 0;
  const disagreements = [];
  for (const s of sheet.rows) {
    const label = s.label?.window;
    if (!WINDOW_LABELS.includes(label)) {
      skipped += 1;
      continue;
    }
    const row = byKey.get(key[s.id]);
    if (row === undefined) {
      skipped += 1;
      continue;
    }
    const said = row.answer.statedDurations;
    const reader = said.length === 0 ? 'none' : said.length === 1 ? said[0] : 'several';
    labelled += 1;
    if (reader === label) agree += 1;
    else disagreements.push({ id: s.id, label, reader });
  }
  return {
    labelled,
    agree,
    skipped,
    agreement: labelled === 0 ? undefined : agree / labelled,
    disagreements,
  };
}
