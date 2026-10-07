/**
 * bench/cache/share.mjs — how much of a conversation's request bytes a prompt cache can serve.
 *
 * Pure functions over Anthropic Messages wire bodies (the `params` an SDK client is handed). No
 * library import: the same arithmetic reads a body built by any release, so a before/after pair
 * is measured by one ruler.
 *
 * The model of the cache is Anthropic's documented one, kept deliberately small:
 *   - the prompt renders in a fixed order — `tools`, then `system`, then `messages`;
 *   - a `cache_control` breakpoint WRITES an entry keyed by the exact bytes of everything up to
 *     and including its block;
 *   - a later request READS the longest such entry whose bytes it repeats exactly, found at one of
 *     its own breakpoints or at most `lookback` blocks before one (the 20-block window);
 *   - a `cache_control` field is a placement, not content — it never changes a key, and a string
 *     `content` / `system` is the same prompt as one text block holding it;
 *   - `tool_choice` and `thinking` sit between `system` and `messages` here, because changing
 *     either invalidates the messages cache while tools and system stay valid.
 *
 * Not modelled: the per-model minimum (Haiku 4.5 caches nothing under 4,096 tokens — read the
 * `cacheable` column against that), the 5-minute TTL, and token counts. Shares are in BYTES of the
 * serialized blocks, which is what a reader can check by hand.
 */

/** One rendered position: `key` is what the cache compares, `bytes` what it would serve. */
function block(kind, value) {
  const key = `${kind}:${JSON.stringify(value)}`;
  return { key, bytes: Buffer.byteLength(JSON.stringify(value)) };
}

/** A content array or string → its blocks, `cache_control` stripped, with breakpoint flags. */
function contentBlocks(kind, content, out) {
  const list = typeof content === 'string' ? [{ type: 'text', text: content }] : content ?? [];
  for (const raw of list) {
    const { cache_control: mark, ...rest } = raw;
    out.push({ ...block(kind, rest), breakpoint: mark !== undefined });
  }
}

/**
 * The rendered prompt of one wire body, in cache order.
 *
 * @param {object} body  an Anthropic Messages request body
 * @returns {{ key: string, bytes: number, breakpoint: boolean }[]}
 */
export function wireBlocks(body) {
  const out = [];
  for (const tool of body.tools ?? []) {
    const { cache_control: mark, ...rest } = tool;
    out.push({ ...block('tool', rest), breakpoint: mark !== undefined });
  }
  if (body.system !== undefined) contentBlocks('system', body.system, out);
  const settings = { tool_choice: body.tool_choice ?? null, thinking: body.thinking ?? null };
  out.push({ ...block('settings', settings), breakpoint: false });
  for (const m of body.messages ?? []) contentBlocks(`message:${m.role}`, m.content, out);
  return out;
}

/** Running prefix keys: `prefix[i]` names blocks 0..i exactly. */
function prefixKeys(blocks) {
  const keys = [];
  let acc = '';
  for (const b of blocks) {
    acc += `\u0001${b.key}`;
    keys.push(acc);
  }
  return keys;
}

/**
 * Replays one conversation's requests through the cache model.
 *
 * @param {object[]} bodies   the wire bodies of ONE run, in the order they were sent
 * @param {{ lookback?: number }} [opts]
 * @returns {{ calls: number, total: number, marked: number, read: number,
 *             perCall: { total: number, marked: number, read: number, breakpoints: number }[] }}
 *   `total` — bytes sent; `marked` — bytes up to the request's last breakpoint (what it OFFERS to
 *   cache); `read` — bytes an earlier request of the same run had written and this one repeats.
 */
export function replayConversation(bodies, opts = {}) {
  const lookback = opts.lookback ?? 20;
  const written = new Set();
  const perCall = [];
  for (const body of bodies) {
    const blocks = wireBlocks(body);
    const keys = prefixKeys(blocks);
    const sums = [];
    let running = 0;
    for (const b of blocks) sums.push((running += b.bytes));
    const total = running;
    const marks = [];
    blocks.forEach((b, i) => b.breakpoint && marks.push(i));
    const marked = marks.length > 0 ? sums[marks[marks.length - 1]] : 0;
    let readAt = -1;
    for (const p of marks) {
      for (let r = p; r >= 0 && r >= p - lookback; r -= 1) {
        if (written.has(keys[r])) {
          if (r > readAt) readAt = r;
          break;
        }
      }
    }
    const read = readAt >= 0 ? sums[readAt] : 0;
    for (const p of marks) written.add(keys[p]);
    perCall.push({ total, marked, read, breakpoints: marks.length });
  }
  const sum = (k) => perCall.reduce((s, c) => s + c[k], 0);
  return {
    calls: perCall.length,
    total: sum('total'),
    marked: sum('marked'),
    read: sum('read'),
    perCall,
  };
}

/**
 * Folds many runs into one row.
 *
 * @param {ReturnType<typeof replayConversation>[]} runs
 */
export function foldShares(runs) {
  const total = runs.reduce((s, r) => s + r.total, 0);
  const marked = runs.reduce((s, r) => s + r.marked, 0);
  const read = runs.reduce((s, r) => s + r.read, 0);
  const calls = runs.reduce((s, r) => s + r.calls, 0);
  const callsAfterFirst = runs.reduce((s, r) => s + Math.max(0, r.calls - 1), 0);
  const callsThatRead = runs.reduce((s, r) => s + r.perCall.filter((c) => c.read > 0).length, 0);
  // A conversation's first call has nothing to read, so the share of the REPEAT calls is the
  // number that says how much of a request the cache serves once a conversation is going.
  const repeatTotal = runs.reduce(
    (s, r) => s + r.perCall.slice(1).reduce((t, c) => t + c.total, 0),
    0,
  );
  return {
    runs: runs.length,
    calls,
    callsAfterFirst,
    callsThatRead,
    total,
    marked,
    read,
    markedShare: total === 0 ? 0 : marked / total,
    readShare: total === 0 ? 0 : read / total,
    repeatReadShare: repeatTotal === 0 ? 0 : read / repeatTotal,
  };
}
