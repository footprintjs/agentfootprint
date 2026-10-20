/** Pilot-only guard. Reservations never refund; real usage is a separate measurement.
 * Reserve the ENTIRE documented 200K model window at the higher 1h cache-write
 * tariff, even though the pilot accepts only default/5m marks and <=96KB JSON.
 * No tokenizer estimate is allowed to shrink the pre-send reservation.
 * Tariff/context sources and assumptions are frozen in README + manifest.json.
 */
import { copyJson } from '../../../dist/lib/boundedJson.js';
import { usageEvidence } from './usageEvidence.mjs';
export const MODEL = 'claude-haiku-4-5-20251001';
export const RESERVATION_MICRO_USD = 405120;
const CEILINGS = Object.freeze({
  maxMicroUsd: 10_000_000,
  maxCalls: 16,
  maxCallsPerArm: 8,
  maxCallsPerRun: 4,
  maxDurationMs: 600_000,
  callTimeoutMs: 45_000,
});
const allowed = new Set([
  'model',
  'max_tokens',
  'messages',
  'system',
  'tools',
  'tool_choice',
  'temperature',
  'stream',
]);
function request(input) {
  const body = copyJson(input, 96_000, false);
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== 'object' ||
    Object.keys(body).some((k) => !allowed.has(k))
  )
    throw new Error('pilot request fields refused');
  if (
    body.model !== MODEL ||
    !Number.isSafeInteger(body.max_tokens) ||
    body.max_tokens < 1 ||
    body.max_tokens > 1024 ||
    (body.stream !== undefined && body.stream !== false)
  )
    throw new Error('pilot model/output/stream cap');
  if (
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    (body.tools !== undefined &&
      (!Array.isArray(body.tools) ||
        body.tools.some((t) => t.name !== 'lookup' || ('type' in t && t.type !== 'custom'))))
  )
    throw new Error('pilot tools/messages refused');
  let marks = 0;
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    if ('cache_control' in value) {
      const c = value.cache_control;
      if (
        !c ||
        c.type !== 'ephemeral' ||
        (c.ttl !== undefined && c.ttl !== '5m') ||
        Object.keys(c).some((k) => !['type', 'ttl'].includes(k))
      )
        throw new Error('pilot cache policy refused');
      if (++marks > 4) throw new Error('pilot cache marker cap');
    }
    Object.values(value).forEach(inspect);
  }
  inspect(body);
  body.service_tier = 'standard_only';
  return copyJson(body, 96_000, false);
}
/** Missing counts stay unknown. A known cost is not a reservation refund. */
export function measuredUsage(value) {
  const u = copyJson(value, 8_192, false);
  const fields = [
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
  ];
  const known = new Set([
    ...fields,
    'cache_creation',
    'service_tier',
    'inference_geo',
    'server_tool_use',
    'output_tokens_details',
    'speed',
  ]);
  if (
    !u ||
    Array.isArray(u) ||
    typeof u !== 'object' ||
    Object.keys(u).some((k) => !known.has(k)) ||
    fields.some((k) => !Number.isSafeInteger(u[k]) || u[k] < 0) ||
    u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens > 200_000 ||
    u.output_tokens > 1024
  )
    throw new Error('pilot usage is missing or outside its bounds');
  if (
    u.cache_creation != null &&
    (Object.keys(u.cache_creation).some(
      (k) => !['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'].includes(k),
    ) ||
      !Number.isSafeInteger(u.cache_creation.ephemeral_5m_input_tokens) ||
      u.cache_creation.ephemeral_5m_input_tokens !== u.cache_creation_input_tokens ||
      u.cache_creation.ephemeral_1h_input_tokens !== 0)
  )
    throw new Error('pilot usage cache TTL is unknown or unexpected');
  // Allow only metadata for the frozen token-only, standard/global tariff.
  // Unknown/new charge categories stop measurement, never silently price as zero.
  if (
    (u.service_tier != null && u.service_tier !== 'standard') ||
    // Frozen Haiku4.5 does not support geographic routing premiums. Preserve the
    // documented older-model label verbatim; never rewrite it as a measured geo.
    // Verified2026-10-20: https://platform.claude.com/docs/en/manage-claude/data-residency
    (u.inference_geo != null && !['global', 'not_available'].includes(u.inference_geo)) ||
    // This label is documented on usage. Fast/unknown speeds remain unpriced.
    // https://platform.claude.com/docs/en/api/messages/create
    (u.speed != null && u.speed !== 'standard') ||
    (u.server_tool_use != null &&
      (Object.keys(u.server_tool_use).some(
        (k) => !['web_fetch_requests', 'web_search_requests'].includes(k),
      ) ||
        u.server_tool_use.web_fetch_requests !== 0 ||
        u.server_tool_use.web_search_requests !== 0)) ||
    (u.output_tokens_details != null &&
      (Object.keys(u.output_tokens_details).some((k) => k !== 'thinking_tokens') ||
        u.output_tokens_details.thinking_tokens !== 0))
  )
    throw new Error('pilot usage contains an unexpected charge class');
  const nanoUsd =
    u.input_tokens * 1000 +
    u.output_tokens * 5000 +
    u.cache_creation_input_tokens * 1250 +
    u.cache_read_input_tokens * 100;
  return { raw: u, nanoUsd, microUsd: Math.ceil(nanoUsd / 1000) };
}
export function pilotBudget(options) {
  const limits = { ...CEILINGS };
  for (const [key, max] of Object.entries(CEILINGS)) {
    const value = options[key] ?? max;
    if (!Number.isSafeInteger(value) || value < (key === 'maxMicroUsd' ? 0 : 1) || value > max)
      throw new Error('pilot configured cap refused');
    limits[key] = value;
  }
  const now = options.now ?? (() => performance.now());
  const deadline = now() + limits.maxDurationMs;
  let calls = 0,
    reservedMicroUsd = 0,
    unknownCalls = 0,
    unsentCalls = 0,
    halted = false;
  const arms = new Map(),
    runs = new Map();
  const append = (event) => {
    try {
      if (options.journal(event) !== undefined)
        throw new Error('Journal must finish synchronously.');
    } catch {
      halted = true;
      throw new Error('pilot journal unavailable; halted');
    }
  };
  return {
    snapshot: () => ({
      calls,
      reservedMicroUsd,
      unknownCalls,
      unsentCalls,
      halted,
      limits: { ...limits },
    }),
    async call(input, transport, { arm, run, signal }) {
      if (halted) throw new Error('pilot halted');
      if (!['baseline', 'candidate'].includes(arm) || !['lookup', 'conflict'].includes(run))
        throw new Error('pilot scope refused');
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('pilot deadline');
      if (signal?.aborted) throw new Error('pilot caller already aborted');
      const body = request(input);
      if (now() >= deadline) throw new Error('pilot deadline');
      const key = `${arm}/${run}`;
      if (
        calls >= limits.maxCalls ||
        (arms.get(arm) ?? 0) >= limits.maxCallsPerArm ||
        (runs.get(key) ?? 0) >= limits.maxCallsPerRun ||
        reservedMicroUsd + RESERVATION_MICRO_USD > limits.maxMicroUsd
      )
        throw new Error('pilot spending/call cap');
      const id = calls + 1;
      // Synchronous journal + fsync in the real caller completes BEFORE transport.
      append({ kind: 'reserved', id, arm, run, microUsd: RESERVATION_MICRO_USD });
      calls++;
      reservedMicroUsd += RESERVATION_MICRO_USD;
      arms.set(arm, (arms.get(arm) ?? 0) + 1);
      runs.set(key, (runs.get(key) ?? 0) + 1);
      if (signal?.aborted || now() >= deadline) {
        halted = true;
        unsentCalls++;
        append({ kind: 'not-sent', id, arm, run, reason: signal?.aborted ? 'abort' : 'deadline' });
        throw new Error('pilot deadline/abort after reservation; halted');
      }
      const controller = new AbortController();
      let timer,
        onAbort,
        sent = false,
        reason = 'transport';
      const callDeadline = Math.min(deadline, now() + limits.callTimeoutMs);
      const timeout = callDeadline - now();
      const interrupt = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reason = 'timeout';
          controller.abort();
          reject(new Error('pilot call timeout'));
        }, timeout);
        onAbort = () => {
          reason = 'aborted';
          controller.abort();
          reject(new Error('pilot call aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const response = await Promise.race([
          Promise.resolve().then(() => {
            const remainingAtDispatch = callDeadline - now();
            if (signal?.aborted || controller.signal.aborted || remainingAtDispatch <= 0) {
              reason = signal?.aborted ? 'abort' : now() >= deadline ? 'deadline' : 'timeout';
              throw new Error('pilot dispatch refused');
            }
            sent = true;
            return transport(body, {
              signal: controller.signal,
              timeout: Math.min(remainingAtDispatch, timeout),
              maxRetries: 0,
            });
          }),
          interrupt,
        ]);
        if (signal?.aborted || controller.signal.aborted || now() >= callDeadline) {
          reason = signal?.aborted ? 'aborted' : 'timeout';
          controller.abort();
          throw new Error('pilot answer arrived after deadline/abort');
        }
        let usage;
        try {
          usage = measuredUsage(response.usage);
        } catch {
          reason = 'usage';
          append({ kind: 'usage-refused', id, arm, run, evidence: usageEvidence(response.usage) });
          throw new Error('pilot usage unknown');
        }
        reason = 'journal';
        append({ kind: 'settled', id, arm, run, usage });
        return response;
      } catch {
        halted = true;
        if (sent) {
          unknownCalls++;
          append({
            kind: 'unknown',
            id,
            arm,
            run,
            reason,
            reservedMicroUsd: RESERVATION_MICRO_USD,
          });
        } else {
          unsentCalls++;
          append({ kind: 'not-sent', id, arm, run, reason });
        }
        // Fixed words only; SDK errors may contain request/credential material.
        if (reason === 'timeout') throw new Error('pilot call timeout; reservation retained');
        if (reason === 'usage') throw new Error('pilot usage unknown; reservation retained');
        throw new Error('pilot call unknown; reservation retained; halted');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
