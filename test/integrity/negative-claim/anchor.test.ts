/** An anchor permits an observe-only finding; it never binds an entity or
 * treats model/user text as a native observation. */
import { describe, expect, it } from 'vitest';
import { proseAnchorOf } from '../../../src/integrity/negative-claim/anchor.js';
import { detectNegativeClaims } from '../../../src/integrity/negative-claim/detect.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import type { TurnCall, TurnRecord } from '../../../src/integrity/negative-claim/types.js';
import { incidentCall, turnRecord } from './fixtures.js';

const rows = (text: string, calls: readonly TurnCall[], over: Partial<TurnRecord> = {}) =>
  judgeProseNegatives({ field: '/', text, record: { ...turnRecord(calls), ...over } });
const claims = (text: string, calls: readonly TurnCall[], over: Partial<TurnRecord> = {}) =>
  rows(text, calls, over).filter((row) => row.kind === 'negative-claim');

describe('only native data anchors a negative phrase', () => {
  it('reads each clause token once per native pattern even when long prefixes repeat', () => {
    const text = 'There are no ' + 'a '.repeat(1200) + 'items.';
    const claim = detectNegativeClaims(text).claims[0]!;
    let tokenReads = 0;
    const tokens = claim.tokens.map((token) => ({
      ...token,
      get text() {
        tokenReads += 1;
        return token.text;
      },
    }));
    const call: TurnCall = {
      ...incidentCall(),
      row: undefined,
      scope: undefined,
      arguments: { lookup: 'a '.repeat(600) + 'missing' },
    };
    const matches = proseAnchorOf({ ...turnRecord([call]), tools: {} });
    expect(matches({ ...claim, tokens }, text)).toBe(false);
    expect(tokenReads).toBe(tokens.length);
  });

  it('continues after a folded name candidate fails the exact name rule', () => {
    const call: TurnCall = {
      ...incidentCall(),
      row: undefined,
      scope: undefined,
      arguments: { lookup: 'ARRAY-X9' },
    };
    expect(
      claims('There are no array-x9 or ARRAY-X9 records.', [call], { tools: {} }),
    ).toHaveLength(1);
    expect(claims('There are no array-x9 records.', [call], { tools: {} })).toEqual([]);
  });

  it.each(['No action is needed.', 'Tests: 0 failed.', 'None.', 'No problems here.'])(
    'ignores unrelated ordinary prose: %s',
    (text) => expect(claims(text, [incidentCall()])).toEqual([]),
  );

  it('an unused registered declaration supplies no anchor', () => {
    expect(claims('There are no incidents for payments.', [])).toEqual([]);
  });

  it.each([
    'There are no incidents.',
    'Payments does not exist.',
    'pay-svc does not exist.',
    'There are no open records.',
  ])('observes declared subject, sent/resolved name or declared qualifier: %s', (text) =>
    expect(claims(text, [incidentCall()])).toHaveLength(1),
  );

  it('an actual sent name anchors without silently becoming a resolved entity', () => {
    const call: TurnCall = {
      ...incidentCall(),
      row: undefined,
      scope: undefined,
      arguments: { lookup: 'account-17' },
    };
    expect(claims('Account-17 does not exist.', [call], { tools: {} })).toEqual([]);
    expect(claims('account-17 does not exist.', [call], { tools: {} })).toEqual([
      expect.objectContaining({ notes: ['entity-unresolved'], results: [] }),
    ]);
  });

  it('supports numeric sent identities without inferring a different spelling', () => {
    const call = { ...incidentCall(), row: undefined, arguments: { item: 42 } };
    expect(claims('Item 42 does not exist.', [call])).toHaveLength(1);
    expect(claims('Item 042 does not exist.', [call])).toEqual([]);
  });

  it('the person’s words cannot create a native anchor', () => {
    expect(
      judgeProseNegatives({
        field: '/',
        text: 'There are no invoices.',
        personMessage: 'Please look up invoices.',
        record: turnRecord([]),
      }),
    ).toEqual([]);
  });

  it.each([{ effect: 'not-read' as const }, { dispatched: false }])(
    'a write or non-dispatched proposal supplies no anchor: %j',
    (over) =>
      expect(
        claims('There are no incidents for payments.', [{ ...incidentCall(), ...over }]),
      ).toEqual([]),
  );

  it('a failed dispatched read still anchors an honest call-not-read note', () => {
    expect(
      claims('There are no incidents for payments.', [incidentCall({ outcome: 'error' })]),
    ).toEqual([expect.objectContaining({ notes: expect.arrayContaining(['call-not-read']) })]);
  });

  it('an anchor in another clause cannot promote an unrelated negative', () => {
    expect(claims('We searched payments, but no action is needed.', [incidentCall()])).toEqual([]);
  });

  it('a bare none is not an entity claim even when it is a sent value', () => {
    expect(claims('None.', [incidentCall({ service: 'none' })])).toEqual([]);
  });

  it('never reads host-only values as anchors', () => {
    const call: TurnCall = {
      ...incidentCall(),
      row: undefined,
      scope: [
        {
          what: 'tenant',
          facet: 'filter',
          argument: 'tenant',
          value: 'private-tenant',
          from: 'host',
        },
      ],
      arguments: { tenant: 'private-tenant' },
    };
    expect(claims('private-tenant does not exist.', [call])).toEqual([]);
    const search = turnRecord([call]).tools.list_incidents.search!;
    const tools = {
      list_incidents: {
        name: 'list_incidents',
        search: {
          ...search,
          arguments: [
            ...search.arguments,
            {
              name: 'tenant',
              role: 'filter' as const,
              said: { 'private-tenant': ['private-tenant'] },
            },
          ],
        },
      },
    };
    expect(claims('private-tenant does not exist.', [call], { tools })).toEqual([]);
  });

  it('kept-out payloads and arbitrary result text supply no anchor', () => {
    const hidden = { ...incidentCall({ service: 'private-service' }), keptOut: true as const };
    expect(claims('private-service does not exist.', [hidden])).toEqual([]);
    const call = { ...incidentCall(), rowsRead: [{ entity: 'private-result' }] };
    expect(claims('private-result does not exist.', [call])).toEqual([]);
  });

  it('declared words still permit a record-incomplete note for a hidden read', () => {
    expect(claims('There are no incidents.', [{ ...incidentCall(), keptOut: true }])).toEqual([
      expect.objectContaining({ notes: ['record-incomplete'], results: [] }),
    ]);
  });

  it('keeps stale native anchors dated instead of making them current', () => {
    expect(
      claims('There are no incidents for payments.', [incidentCall({ turn: 1 })], { turn: 2 }),
    ).toEqual([expect.objectContaining({ notes: ['stale-turn'], staleSince: { turn: 1 } })]);
  });

  it('code and unsupported-language notes do not require a data anchor', () => {
    expect(rows('`none`', [])).toEqual([expect.objectContaining({ code: 'in-code-block' })]);
    expect(rows('支付服务没有未解决的事件。', [])).toEqual([
      expect.objectContaining({ code: 'language-unsupported' }),
    ]);
  });
});
