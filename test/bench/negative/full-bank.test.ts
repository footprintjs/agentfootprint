import { describe, expect, it } from 'vitest';
// @ts-expect-error The benchmark is a standalone Node ESM script.
import { translateBank, translateCase, validateBank } from '../../../bench/negative/full/bank.mjs';

function fixture(overrides = {}) {
  const subject = { singular: 'record', plural: 'records' };
  const call = {
    index: 1,
    tool_name: 'read_records',
    schema: {
      operation: 'search',
      properties: {
        source: { type: 'string' },
        account: { type: 'string' },
        entity: { type: 'string' },
      },
      search_read_declaration: {
        subject,
        source_argument: 'source',
        account_argument: 'account',
        entity_argument: 'entity',
      },
    },
    arguments: { source: 'example-source', account: 'example-account', entity: 'example-entity' },
    result: {
      kind: 'absent',
      rows: [],
      scope: { source: 'example-source' },
      revision: 'r1',
      completeness: { status: 'complete', gaps: [] },
      paging: { has_more: false, next_cursor: null },
    },
  };
  return {
    id: 'generic',
    question: 'Are there records?',
    entity: 'example-entity',
    subject,
    tool_calls: [call],
    sonnet_subset_selected: false,
    ...overrides,
  };
}

describe('private bank translation', () => {
  it('derives declarations from tool facts and keeps the oracle outside the prompt', () => {
    const original = fixture({
      expected_answer_boundaries: { prohibited_claims: ['private evaluator label'] },
    });
    const result = translateCase(original);
    expect(result.prompt).toBe(original.question);
    expect(JSON.stringify(result.tools)).not.toContain('private evaluator label');
    expect(result.oracle).toEqual(original);
    expect(result.tools[0].search.arguments).toEqual([
      {
        name: 'source',
        role: 'source',
        said: { 'example-source': ['example-source', 'example source'] },
      },
      {
        name: 'account',
        role: 'filter',
        said: { 'example-account': ['example-account', 'example account'] },
      },
      { name: 'entity', role: 'population' },
    ]);
    expect(result.tools[0].responses[0].value.checked).toBe('declared');
  });

  it('keeps undeclared empty results and refusals distinct from absences', () => {
    const raw = fixture();
    raw.tool_calls[0].schema.search_read_declaration = null;
    raw.tool_calls[0].result.kind = 'rows';
    raw.tool_calls[0].result.completeness.status = 'undeclared';
    expect(translateCase(raw).tools[0]).not.toHaveProperty('search');
    expect(translateCase(raw).tools[0].responses[0]).toMatchObject({ kind: 'raw', value: [] });
    const refusal = fixture();
    refusal.tool_calls[0].result.kind = 'refusal';
    refusal.tool_calls[0].result.explanation = 'Access refused before reading.';
    expect(translateCase(refusal).tools[0].responses[0].kind).toBe('throw');
  });

  it('converts half-open dates explicitly without widening the result interval', () => {
    const item = fixture();
    const call = item.tool_calls[0];
    call.schema.properties.period = { type: 'object' };
    call.schema.search_read_declaration.period_argument = 'period';
    call.arguments.period = { start: '2040-02-01', end_exclusive: '2040-02-03' };
    const result = translateCase(item);
    expect(result.clock).toBe('2040-02-01T00:00:00Z');
    expect(result.schedule[0][0].arguments).toMatchObject({
      from: '2040-02-01T00:00:00Z',
      to: '2040-02-03T00:00:00Z',
    });
    expect(result.tools[0].period.forms[0].to.edge).toBe('exclusive');
    expect(result.tools[0].responses[0].value.period.queried.to).toBe('2040-02-02T23:59:59.999Z');
    expect(result.oracle.tool_calls[0].arguments.period).toEqual(call.arguments.period);
  });

  it('retains relevant gaps, page state, and every row identity', () => {
    const item = fixture();
    const call = item.tool_calls[0];
    call.result.kind = 'rows';
    call.result.rows = [{ id: 'row-a', entity: 'other-entity' }];
    call.result.completeness = {
      status: 'partial',
      gaps: [{ kind: 'partition', value: 'unavailable partition', applies_to: 'requested source' }],
    };
    call.result.paging = { has_more: true, next_cursor: 'next-page' };
    const definition = translateCase(item).tools[0];
    expect(definition.search).not.toHaveProperty('complete');
    expect(definition.search.gaps[0].bears).toBe('completeness');
    expect(definition.responses[0].value.facts[0].entity).toBe('other-entity');
    expect(definition.responses[0].value.paging.next).toBe('next-page');
  });

  it('uses among only when the source explicitly declares a counted name-index miss', () => {
    const item = fixture();
    Object.assign(item.tool_calls[0].result, {
      name_index: {
        argument: 'entity',
        source: 'example-index',
        count: 9,
        measuredAt: '2040-02-01T09:00:00Z',
        completeWithinIndex: true,
        asked_name_present: false,
      },
    });
    const response = translateCase(item).tools[0].responses[0];
    expect(response.value.among).toEqual({
      argument: 'entity',
      source: 'example-index',
      count: 9,
      measuredAt: '2040-02-01T09:00:00Z',
    });
    expect(response.value).not.toHaveProperty('provenance');
    expect(translateCase(fixture()).tools[0].responses[0].value).not.toHaveProperty('among');
  });

  it('preserves frozen context and starts the follow-up without fresh evidence', () => {
    const item = fixture();
    item.long_context_two_turn = {
      selected: true,
      turn_one_question: 'First?',
      turn_two_question: 'Still current?',
      fresh_turn_two_tool_calls: structuredClone(item.tool_calls),
      fresh_reread_policy: { required: true },
      expected_turn_two: { negative_required: true },
      stale_prior_read_indices: [1],
    };
    const bank = {
      shared_long_context_material: { paragraphs: ['Frozen text one.', 'Frozen text two.'] },
    };
    const result = translateCase(item, bank);
    expect(result.longContext.padding).toBe('Frozen text one.\n\nFrozen text two.');
    expect(result.longContext.schedule).toEqual([]);
    expect(result.longContext.freshSchedule).toHaveLength(1);
    expect(result.tools[0].responses).toHaveLength(2);
  });

  it('rejects duplicate IDs, collisions, and unclassified search arguments', () => {
    expect(() => validateBank({ cases: [fixture(), fixture()] })).toThrow('unique');
    const item = fixture();
    item.tool_calls[0].schema.properties.extra = { type: 'string' };
    item.tool_calls[0].arguments.extra = 'unclassified';
    expect(() => translateBank({ cases: [item] })).toThrow('unclassified');
  });
});
