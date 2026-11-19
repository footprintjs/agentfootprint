export const PROJECTED_LIMIT_UNITS = 16_000_000;
export const SPEND_LIMIT_UNITS = 20_000_000;
export const MAX_OUTPUT_TOKENS = 4_096;

const MODEL_CONTEXT_TOKENS = 1_000_000;
// At the higher Haiku 5.5 tier, one input token costs one unit and one output token costs five.
export const FULL_EXPOSURE_UNITS = unitsFor(MODEL_CONTEXT_TOKENS, MAX_OUTPUT_TOKENS);

export function unitsFor(input, output) {
  return input + 5 * output;
}

export function toDollars(units) {
  return units / 2_000_000;
}

export function estimateInputTokens(inputBytes) {
  // Allow one token per two serialized bytes plus the largest published tool framing allowance.
  return Math.ceil(inputBytes / 2) + 406;
}

export class BudgetExceededError extends Error {
  constructor(reason) {
    super(`Benchmark budget stopped: ${reason}`);
    this.name = 'BudgetExceededError';
    this.reason = reason;
  }
}

function isTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createBudget(append) {
  let chargedUnits = 0;
  let exposureUnits = 0;
  let dispatches = 0;
  let unknownUsage = 0;
  let stopped = false;
  let pending;

  function snapshot() {
    return { chargedUnits, exposureUnits, dispatches, unknownUsage, stopped };
  }

  function record(event) {
    try {
      append(event);
    } catch (error) {
      stopped = true;
      throw error;
    }
  }

  function stop(reason, details = {}) {
    stopped = true;
    record({ type: 'budget-stop', reason, ...details, ...snapshot() });
    const error = new BudgetExceededError(reason);
    if (details.settlement) error.settlement = details.settlement;
    throw error;
  }

  function reserve({ inputBytes, maxTokens, ...metadata }) {
    if (stopped) stop('already stopped', { metadata });
    if (pending) stop('a request is already in flight', { metadata });
    if (!isTokenCount(inputBytes) || !isTokenCount(maxTokens) || maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS) {
      stop('invalid request size or output cap', { metadata });
    }

    const estimatedInputTokens = estimateInputTokens(inputBytes);
    const boundUnits = unitsFor(estimatedInputTokens, maxTokens);
    if (boundUnits > SPEND_LIMIT_UNITS - chargedUnits) {
      stop('byte reservation exceeds the spend limit', { metadata, boundUnits });
    }
    // Serialized bytes only estimate tokens. Full exposure is held for the one in-flight
    // request and any requests without final usage, then released as usage becomes known.
    if (FULL_EXPOSURE_UNITS > SPEND_LIMIT_UNITS - Math.max(chargedUnits, exposureUnits)) {
      stop('full exposure exceeds the spend limit', { metadata, boundUnits });
    }

    const ticket = Object.freeze({
      ...metadata,
      id: dispatches + 1,
      inputBytes,
      maxTokens,
      estimatedInputTokens,
      boundUnits,
    });
    pending = ticket;
    dispatches += 1;
    exposureUnits += FULL_EXPOSURE_UNITS;
    record({ type: 'dispatch', ticket, ...snapshot() });
    return ticket;
  }

  function settle(ticket, usage) {
    if (!pending || ticket !== pending) throw new TypeError('Expected the live budget ticket');

    const input = usage?.input;
    const output = usage?.output;
    const cacheReads = usage?.cache_read_input_tokens ?? 0;
    const cacheWrites = usage?.cache_creation_input_tokens ?? 0;
    const valid = isTokenCount(input) && input <= MODEL_CONTEXT_TOKENS &&
      isTokenCount(output) && output <= ticket.maxTokens && cacheReads === 0 && cacheWrites === 0;
    const settlement = Object.freeze({
      inputTokens: valid ? input : ticket.estimatedInputTokens,
      outputTokens: valid ? output : ticket.maxTokens,
      usageKnown: valid,
      chargedUnits: valid ? unitsFor(input, output) : ticket.boundUnits,
    });
    pending = undefined;
    chargedUnits += settlement.chargedUnits;
    if (valid) {
      exposureUnits -= FULL_EXPOSURE_UNITS - settlement.chargedUnits;
    } else {
      unknownUsage += 1;
    }

    record({
      type: 'settle',
      id: ticket.id,
      settlement,
      usage: valid ? { input, output } : null,
      ...snapshot(),
    });
    if (!valid && usage !== undefined) stop('usage outside the request contract', { id: ticket.id, settlement });
    return settlement;
  }

  return { reserve, settle, snapshot };
}
