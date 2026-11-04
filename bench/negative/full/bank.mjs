/** Translate an external, private semantic case bank into native fixture inputs.
 * No case text, expected answers, or evaluation output belongs in this module.
 * The original case is retained as an evaluator-only oracle, never a prompt. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const copy = (value) => JSON.parse(JSON.stringify(value));
const word = (value) => typeof value === 'string' && value.trim().length > 0;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const words = (value) => [...new Set([value, value.replaceAll('-', ' ')])];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Validate authored facts, independently of runtime checker behavior. */
export function validateBank(bank) {
  assert(plain(bank) && Array.isArray(bank.cases) && bank.cases.length > 0, 'bank needs cases');
  const ids = new Set();
  for (const item of bank.cases) {
    assert(word(item.id) && !ids.has(item.id), 'case IDs must be unique nonempty strings');
    ids.add(item.id);
    assert(word(item.question) && word(item.entity), `${item.id}: question and entity required`);
    assert(
      word(item.subject?.singular) && word(item.subject?.plural),
      `${item.id}: subject words required`,
    );
    assert(
      Array.isArray(item.tool_calls) && item.tool_calls.length > 0,
      `${item.id}: calls required`,
    );
    for (const [position, call] of item.tool_calls.entries()) {
      assert(call.index === position + 1, `${item.id}: call indices must be sequential`);
      assert(
        word(call.tool_name) && plain(call.schema?.properties) && plain(call.arguments),
        `${item.id}: call schema required`,
      );
      assert(
        ['absent', 'rows', 'refusal', 'error'].includes(call.result?.kind),
        `${item.id}: unsupported result kind`,
      );
      assert(Array.isArray(call.result.rows), `${item.id}: result rows required`);
      for (const key of Object.keys(call.arguments))
        assert(
          Object.hasOwn(call.schema.properties, key),
          `${item.id}: undeclared argument ${key}`,
        );
    }
    if (item.near_match_subarm?.selected) {
      const near = item.near_match_subarm;
      assert(
        Array.isArray(near.candidates) && near.candidates.length <= 3,
        `${item.id}: at most three candidates`,
      );
      for (const candidate of near.candidates)
        assert(
          candidate.normalized_edit_distance <= 2 || candidate.distance_fraction_of_longer <= 0.25,
          `${item.id}: candidate exceeds frozen distance threshold`,
        );
      if (near.index_fact !== undefined) {
        assert(
          Number.isInteger(near.index_fact.totalCount) &&
            near.index_fact.totalCount >= near.candidates.length,
          `${item.id}: actual index count required`,
        );
        assert(
          near.index_fact.asked_name_present === false && word(near.index_fact.source),
          `${item.id}: index miss facts required`,
        );
      }
    }
  }
  const required = bank.strata_requirements;
  if (required) {
    assert(bank.cases.length === required.case_count, 'bank case count differs from frozen design');
    for (const [stratum, count] of Object.entries(required.primary_counts ?? {}))
      assert(
        bank.cases.filter((item) => item.primary_stratum === stratum).length === count,
        `bank primary stratum count differs: ${stratum}`,
      );
  }
  for (const field of ['near_match_case_ids', 'long_context_case_ids', 'sonnet_subset_case_ids']) {
    if (bank[field] === undefined) continue;
    assert(
      Array.isArray(bank[field]) && new Set(bank[field]).size === bank[field].length,
      `${field} must be a unique selection`,
    );
    assert(
      bank[field].every((id) => ids.has(id)),
      `${field} contains an unknown case`,
    );
  }
  return bank;
}

function instant(value) {
  assert(word(value), 'period bound must be text');
  // A declared calendar date is run in the benchmark's explicit UTC clock.
  const result = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  assert(Number.isFinite(Date.parse(result)), 'invalid authored period bound');
  return result;
}

function normalizedCall(call) {
  const args = {},
    properties = {},
    roles = [];
  const declaration = call.schema.search_read_declaration;
  let period, askOrAssume;
  for (const [name, property] of Object.entries(call.schema.properties)) {
    const value = call.arguments[name];
    if (name === declaration?.period_argument) {
      assert(
        plain(value) && word(value.start) && word(value.end_exclusive),
        'period requires start/end_exclusive',
      );
      assert(
        !Object.hasOwn(call.schema.properties, 'from') &&
          !Object.hasOwn(call.schema.properties, 'to'),
        'period normalization would collide with authored arguments',
      );
      args.from = instant(value.start);
      args.to = instant(value.end_exclusive);
      assert(
        Date.parse(args.from) < Date.parse(args.to),
        'period must be a nonempty half-open range',
      );
      properties.from = { type: 'string' };
      properties.to = { type: 'string' };
      roles.push({ name: 'from', role: 'period' }, { name: 'to', role: 'period' });
      period = {
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'from', as: 'iso' },
            to: { argument: 'to', as: 'iso', edge: 'exclusive' },
          },
        ],
      };
      askOrAssume = {
        from: { ask: 'What is the inclusive start instant?' },
        to: { ask: 'What is the exclusive end instant?' },
      };
      continue;
    }
    if (name === declaration?.filter_argument && plain(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const flat = `filter_${key}`;
        assert(
          !Object.hasOwn(call.schema.properties, flat) && !Object.hasOwn(properties, flat),
          'filter normalization would collide with authored arguments',
        );
        assert(
          ['string', 'number', 'boolean'].includes(typeof entry),
          'filter values must be scalar',
        );
        args[flat] = entry;
        properties[flat] = { type: Number.isInteger(entry) ? 'integer' : typeof entry };
        roles.push({ name: flat, role: 'filter', said: { [String(entry)]: words(String(entry)) } });
      }
      continue;
    }
    args[name] = copy(value);
    properties[name] = { type: property.type };
    let role = 'inert';
    if (name === declaration?.entity_argument) role = 'population';
    else if (name === declaration?.source_argument) role = 'source';
    else if (name === declaration?.account_argument) role = 'filter';
    else if (['limit', 'top_k'].includes(name)) role = 'cap';
    else if (['page_cursor', 'page'].includes(name)) role = 'page';
    // Extra selection-bearing arguments must be classified, never guessed by a tool name.
    else if (declaration && !['record_id'].includes(name))
      throw new Error(`unclassified authored search argument: ${name}`);
    roles.push({
      name,
      role,
      ...(['source', 'filter'].includes(role) && word(value)
        ? { said: { [value]: words(value) } }
        : {}),
    });
  }
  return { args, properties, roles, period, askOrAssume };
}

const gapFacet = (gap) => {
  if (['source', 'outside_source'].includes(gap.kind)) return 'source';
  if (gap.kind === 'period') return 'period';
  if (gap.kind === 'permission') return 'population';
  if (['cap', 'page', 'partition', 'retrieval'].includes(gap.kind)) return 'completeness';
  throw new Error(`unclassified authored gap: ${gap.kind}`);
};

function coverageLists(call) {
  const notChecked = [],
    cannotCover = [];
  for (const gap of call.result.completeness.gaps) {
    const entry = { what: gap.value, why: gap.applies_to };
    (['outside_source', 'source', 'permission'].includes(gap.kind) ? cannotCover : notChecked).push(
      entry,
    );
  }
  return { ...(notChecked.length && { notChecked }), ...(cannotCover.length && { cannotCover }) };
}

function resultFacts(call, normalized) {
  const result = call.result;
  const provenance = { source: result.scope.source, measuredAt: `snapshot ${result.revision}` };
  const facts = { provenance };
  if (normalized.period) {
    // Result periods are inclusive; input bounds and source oracle stay half-open.
    const queried = {
      from: normalized.args.from,
      to: new Date(Date.parse(normalized.args.to) - 1).toISOString(),
    };
    facts.period = {
      queried,
      held: result.completeness.status === 'complete' ? copy(queried) : 'unknown',
    };
  }
  if (result.paging.has_more === false) facts.paging = { next: null };
  else if (result.paging.has_more === true && result.paging.next_cursor !== null)
    facts.paging = { next: result.paging.next_cursor };
  return facts;
}

function responseFor(call, normalized) {
  const result = call.result;
  const base = {
    when: normalized.args,
    ...(result.completeness.status === 'partial' && { status: 'partial' }),
  };
  if (result.kind === 'error' || result.kind === 'refusal')
    return {
      ...base,
      kind: 'throw',
      value: `${result.kind}: ${
        result.explanation ?? result.completeness.gaps.map((g) => g.value).join('; ')
      }`,
    };
  const declaration = call.schema.search_read_declaration;
  const facts = resultFacts(call, normalized);
  const coverage = coverageLists(call);
  if (result.kind === 'absent') {
    assert(declaration, 'authored absence needs a search declaration in this bank');
    if (result.name_index) {
      const index = result.name_index;
      assert(
        index.asked_name_present === false && Number.isInteger(index.count) && index.count >= 0,
        'among metadata requires an explicitly authored counted name miss',
      );
      const otherFacts = { ...facts };
      delete otherFacts.provenance;
      return {
        ...base,
        kind: 'absent',
        value: {
          what: call.arguments[index.argument],
          among: {
            argument: index.argument,
            source: index.source,
            measuredAt: index.measuredAt,
            count: index.count,
            ...(index.completeWithinIndex === false && { partial: true }),
          },
          ...coverage,
          ...otherFacts,
        },
      };
    }
    return {
      ...base,
      kind: 'absent',
      value: {
        what: `${declaration.subject.plural} for ${call.arguments[declaration.entity_argument]}`,
        checked: 'declared',
        ...coverage,
        ...facts,
      },
    };
  }
  if (result.completeness.status === 'undeclared')
    return { ...base, kind: 'raw', value: copy(result.rows) };
  // Rows keep their authored identity; an envelope never binds a near-name row to the requested entity.
  const rows = result.rows.map((row) => ({
    ...copy(row),
    entity: row.entity ?? call.arguments.entity,
  }));
  return {
    ...base,
    kind: 'described',
    value: { facts: rows, ...facts, ...(Object.keys(coverage).length && { coverage }) },
  };
}

function definitionFor(calls) {
  const first = calls[0],
    normalized = calls.map(normalizedCall);
  const declaration = first.schema.search_read_declaration;
  const properties = Object.assign({}, ...normalized.map((item) => item.properties));
  const definition = {
    name: first.tool_name,
    description: `${first.schema.operation} operation over ${first.arguments.source}; authored fixture responses preserve scope and snapshot.`,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
    ...(first.schema.effects !== undefined && { effects: first.schema.effects }),
    ...(normalized[0].period && {
      period: normalized[0].period,
      askOrAssume: normalized[0].askOrAssume,
    }),
    responses: calls.map((call, index) => responseFor(call, normalized[index])),
  };
  if (!declaration) return definition;
  assert(
    calls.every(
      (call) => JSON.stringify(call.schema.search_read_declaration) === JSON.stringify(declaration),
    ),
    'one tool name must retain its authored search declaration',
  );
  const search = {
    source: { what: first.arguments.source, said: words(first.arguments.source) },
    subject: {
      what: declaration.subject.plural,
      said: [declaration.subject.singular, declaration.subject.plural],
    },
    arguments: normalized[0].roles,
  };
  if (
    ['absent', 'rows'].includes(first.result.kind) &&
    first.result.completeness.status === 'complete'
  )
    search.complete = 'within-arguments';
  const gaps = new Map();
  for (const gap of first.result.completeness.gaps) {
    // A requested interval outside this call is already represented by the actual period bounds.
    // The result's notChecked still discloses it; it is not a permanent tool blind spot.
    if (gap.kind === 'period') continue;
    const value = { what: gap.value, why: gap.applies_to, bears: gapFacet(gap) };
    gaps.set(JSON.stringify(value), value);
    if (gap.kind === 'retrieval') {
      search.ranking = 'approximate';
      delete search.complete;
    }
  }
  if (gaps.size) search.gaps = [...gaps.values()];
  definition.search = search;
  return definition;
}

const scheduleFor = (calls) =>
  calls.map((call) => [{ name: call.tool_name, arguments: normalizedCall(call).args }]);

/** One case; every runtime field comes from schemas/facts, never answer wording. */
export function translateCase(item, bank = {}) {
  const freshCalls = item.long_context_two_turn?.fresh_turn_two_tool_calls ?? [];
  const allCalls = [...item.tool_calls, ...freshCalls];
  const grouped = new Map();
  for (const call of allCalls) {
    if (!grouped.has(call.tool_name)) grouped.set(call.tool_name, []);
    grouped.get(call.tool_name).push(call);
  }
  const result = {
    id: item.id,
    prompt: item.question,
    tools: [...grouped.values()].map(definitionFor),
    schedule: scheduleFor(item.tool_calls),
    sonnet: Boolean(item.sonnet_subset_selected),
    oracle: copy(item),
  };
  const firstPeriod = allCalls.find((call) => call.arguments.period)?.arguments.period;
  if (firstPeriod) result.clock = instant(firstPeriod.start);
  if (item.near_match_subarm?.selected) {
    const near = item.near_match_subarm,
      index = near.index_fact;
    assert(index, `${item.id}: near arm requires independently authored index facts`);
    result.near = {
      source: index.source,
      asked: near.asked_name,
      names: near.candidates.map((entry) => entry.name),
      count: index.totalCount,
      measuredAt: index.measuredAt,
      completeWithinIndex: index.completeWithinIndex,
      scopeLimit: index.scopeLimit,
      lookupArgument: index.lookup_argument,
    };
  }
  if (item.long_context_two_turn?.selected) {
    const long = item.long_context_two_turn;
    const padding = (bank.shared_long_context_material?.paragraphs ?? []).join('\n\n');
    assert(padding.length > 0, 'selected long-context case needs its frozen material');
    result.longContext = {
      firstPrompt: long.turn_one_question,
      followupPrompt: long.turn_two_question,
      padding,
      paddingChars: padding.length,
      schedule: [],
      freshSchedule: scheduleFor(freshCalls),
      freshRereadPolicy: copy(long.fresh_reread_policy),
      expectedFresh: copy(long.expected_turn_two),
      staleReadIndices: copy(long.stale_prior_read_indices),
      staging:
        'The second turn starts without new evidence. Fresh reads are available only as a separately audited reread stage; never silently run before the stale-read probe.',
    };
  }
  return result;
}

export function translateBank(bank, { sourceSha256 } = {}) {
  validateBank(bank);
  return {
    bankId: bank.bank_id,
    sourceSha256: sourceSha256 ?? sha256(JSON.stringify(bank)),
    cases: bank.cases.map((item) => translateCase(item, bank)),
    translationNotes: [
      'The semantic source bank is evaluator-only. Only prompt, tool declarations/results and scheduled calls reach the provider.',
      'Date-only period bounds use the synthetic UTC calendar; object ranges become explicit inclusive from/exclusive to arguments. Original dates remain in oracle.',
      'Result period endpoints are inclusive, so an authored exclusive end is represented there as one millisecond earlier; Tool.period retains the exclusive edge.',
      'Every case call runs sequentially in its own native tool batch; no tool selection is attributed to the paid provider.',
      'Search completeness and gap declarations derive only from schema/result facts. Answer boundaries and prior model outputs do not inform declarations.',
      'Long-context first turns retain the exact authored context text; second turns begin stale, with fresh reread schedules stored separately.',
    ],
  };
}

/** A filename preserves the exact file hash; a parsed object gets a JSON hash. */
export async function loadBank(input) {
  if (typeof input !== 'string') return translateBank(input);
  const bytes = await readFile(input);
  return translateBank(JSON.parse(bytes.toString('utf8')), { sourceSha256: sha256(bytes) });
}
