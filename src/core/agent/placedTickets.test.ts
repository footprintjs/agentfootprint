/** The ticket receipt's rules, one function each (`placedTickets.ts`). */
import { describe, expect, it } from 'vitest';
import {
  carriedTicketsOf,
  isIssuedTicket,
  issuedTicketsOf,
  RECORDED_BEFORE_RECEIPT,
  seededTickets,
  ticketsStillServed,
} from './placedTickets.js';

const ticket = { placed: true, ref: 'art_1', kind: 'dataset/rows', reason: 'staged' };
const issued = issuedTicketsOf([{ toolCallId: 'c1', ref: 'art_1' }]);

describe('isIssuedTicket — who placed it, read from the receipt', () => {
  it('a ticket the receipt lists for that very call is the library’s', () => {
    expect(isIssuedTicket('c1', ticket, issued)).toBe(true);
  });

  it('the same JSON under another call, another ref, or no receipt is not', () => {
    expect(isIssuedTicket('c2', ticket, issued)).toBe(false);
    expect(isIssuedTicket('c1', { ...ticket, ref: 'art_2' }, issued)).toBe(false);
    expect(isIssuedTicket(undefined, ticket, issued)).toBe(false);
    expect(isIssuedTicket('c1', ticket, issuedTicketsOf(undefined))).toBe(false);
  });

  it('a call id reused across turns keeps every ref minted under it, as pairs', () => {
    const receipt = [
      { toolCallId: 't1', ref: 'art_1' },
      { toolCallId: 't1', ref: 'art_2' },
    ];
    const reused = issuedTicketsOf(receipt);
    expect(isIssuedTicket('t1', ticket, reused)).toBe(true);
    expect(isIssuedTicket('t1', { ...ticket, ref: 'art_2' }, reused)).toBe(true);
    expect(isIssuedTicket('t1', { ...ticket, ref: 'art_3' }, reused)).toBe(false);
    expect(ticketsStillServed(receipt, [{ role: 'tool', toolCallId: 't1' }])).toEqual([
      { toolCallId: 't1', ref: 'art_1' },
      { toolCallId: 't1', ref: 'art_2' },
    ]);
  });

  it('a recording older than the receipt answers by shape, as it was sent', () => {
    expect(isIssuedTicket('c9', ticket, RECORDED_BEFORE_RECEIPT)).toBe(true);
    expect(isIssuedTicket('c9', { placed: true }, RECORDED_BEFORE_RECEIPT)).toBe(false);
  });
});

describe('ticketsStillServed — a stored conversation keeps what its history can show', () => {
  it('keeps only tickets whose tool message the history still holds', () => {
    const tickets = [
      { toolCallId: 'gone', ref: 'art_0' },
      { toolCallId: 'c1', ref: 'art_1' },
    ];
    const history = [
      { role: 'user', content: 'q' },
      { role: 'tool', toolCallId: 'c1', content: '{}' },
      { role: 'assistant', toolCallId: 'gone', content: '' },
    ];
    expect(ticketsStillServed(tickets, history)).toEqual([{ toolCallId: 'c1', ref: 'art_1' }]);
  });

  it('nothing left, or nothing placed, stores no key', () => {
    expect(ticketsStillServed([{ toolCallId: 'gone', ref: 'art_0' }], [])).toBeUndefined();
    expect(ticketsStillServed(undefined, [{ role: 'tool', toolCallId: 'c1' }])).toBeUndefined();
  });
});

describe('carriedTicketsOf — the checkpoint door', () => {
  it('copies a well-formed list field by field', () => {
    expect(carriedTicketsOf([{ toolCallId: 'c1', ref: 'art_1', extra: 'dropped' }])).toEqual([
      { toolCallId: 'c1', ref: 'art_1' },
    ]);
  });

  it('refuses anything else by name', () => {
    for (const bad of [{}, 'x', [null], [{ toolCallId: 'c1' }], [{ toolCallId: 1, ref: 'r' }]]) {
      expect(() => carriedTicketsOf(bad)).toThrow(/placedTickets/);
    }
  });
});

describe('seededTickets — what a run starts with', () => {
  it('carried tickets first; an armed nudge alone starts an empty receipt; else nothing', () => {
    expect(seededTickets([{ toolCallId: 'c1', ref: 'art_1' }], false)).toEqual([
      { toolCallId: 'c1', ref: 'art_1' },
    ]);
    expect(seededTickets(undefined, true)).toEqual([]);
    expect(seededTickets([], false)).toBeUndefined();
  });
});
