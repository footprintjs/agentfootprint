/**
 * The request-evidence door — what may enter a run as an MCP request's attempts.
 *
 *   P1 Unit      — a well-formed filing passes as a fresh copy
 *   P5 Security  — anything outside the allow-list is refused WHOLE: an extra
 *                  field, a word outside its set, an error's own text, a URL
 *                  with a path, a label with a control character, a getter,
 *                  a class instance, a hostile proxy; and the door never throws
 *   P1 Unit      — the port is read off a context without trusting it
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_REQUEST_ATTEMPT_ROWS,
  REQUEST_EVIDENCE,
  requestEvidenceFor,
  requestEvidenceOf,
  servedRequestEvidence,
  type RequestEvidence,
} from '../../src/tools/requestEvidence.js';

const WELL_FORMED: RequestEvidence = {
  endpoint: 'tickets-gateway',
  attempts: [
    {
      attempt: 1,
      outcome: 'refused',
      reason: 'retryable',
      status: 429,
      kind: 'throttle',
      failure: 'rate-limited',
      waitMs: 1000,
      retryAfterMs: 1000,
    },
    {
      attempt: 2,
      outcome: 'failed',
      reason: 'not-retryable',
      failure: 'network',
      error: {
        message: 'The request failed before an answer arrived. Its error is not kept.',
        code: 'network',
      },
    },
  ],
  omitted: 0,
  end: {
    outcome: 'failed',
    reason: 'not-retryable',
    failure: 'network',
    error: {
      message: 'The request failed before an answer arrived. Its error is not kept.',
      code: 'network',
    },
  },
};

/** `WELL_FORMED` with one change made by `edit` on a deep copy. */
function filing(edit: (draft: Record<string, any>) => void): unknown {
  const draft = structuredClone(WELL_FORMED) as unknown as Record<string, any>;
  edit(draft);
  return draft;
}

describe('request evidence door — P1 what passes', () => {
  it('a well-formed filing passes, as a fresh copy', () => {
    const served = servedRequestEvidence(WELL_FORMED);
    expect(served).toEqual(WELL_FORMED);
    expect(served).not.toBe(WELL_FORMED);
    expect(served?.attempts[0]).not.toBe(WELL_FORMED.attempts[0]);
  });

  it('an origin — scheme, host and port — passes in place of a label', () => {
    const served = servedRequestEvidence(
      filing((d) => {
        delete d.endpoint;
        d.origin = 'https://mcp.example.test:8443';
      }),
    );
    expect(served?.origin).toBe('https://mcp.example.test:8443');
  });

  it(`up to ${MAX_REQUEST_ATTEMPT_ROWS} attempt rows pass`, () => {
    const rows = Array.from({ length: MAX_REQUEST_ATTEMPT_ROWS }, (_, i) => ({
      attempt: i + 1,
      outcome: 'refused',
      reason: 'retryable',
      waitMs: 0,
    }));
    expect(servedRequestEvidence(filing((d) => (d.attempts = rows)))?.attempts).toHaveLength(
      MAX_REQUEST_ATTEMPT_ROWS,
    );
  });
});

describe('request evidence door — P5 anything else is refused whole', () => {
  const REFUSED: ReadonlyArray<readonly [string, unknown]> = [
    ['an extra top-level field (the call’s arguments)', filing((d) => (d.arguments = { q: 'x' }))],
    ['a field claiming the call’s identity', filing((d) => (d.toolCallId = 'someone-else'))],
    ['an extra row field (the server’s answer)', filing((d) => (d.attempts[0].body = '{"x":1}'))],
    ['an outcome outside its set (success)', filing((d) => (d.attempts[0].outcome = 'succeeded'))],
    ['a reason outside its set', filing((d) => (d.end.reason = 'succeeded'))],
    ['a kind outside its set', filing((d) => (d.attempts[0].kind = 'server-error'))],
    [
      'an error carrying its own text',
      filing((d) => (d.attempts[1].error.message = 'connect ECONNREFUSED 10.0.0.7 token=SECRET')),
    ],
    ['an error code outside the categories', filing((d) => (d.end.error.code = 'ECONNREFUSED'))],
    [
      'an origin with a path',
      filing((d) => ((d.origin = 'https://h.test/tenant'), delete d.endpoint)),
    ],
    [
      'an origin with a query',
      filing((d) => ((d.origin = 'https://h.test?token=x'), delete d.endpoint)),
    ],
    [
      'an origin with user info',
      filing((d) => ((d.origin = 'https://user:pw@h.test'), delete d.endpoint)),
    ],
    ['a label AND an origin', filing((d) => (d.origin = 'https://h.test'))],
    ['a label with a control character', filing((d) => (d.endpoint = 'gate\nway'))],
    ['a label past 128 characters', filing((d) => (d.endpoint = 'x'.repeat(129)))],
    ['a status that is not one', filing((d) => (d.attempts[0].status = 4290))],
    ['a negative wait', filing((d) => (d.attempts[0].waitMs = -1))],
    ['an attempt numbered 0', filing((d) => (d.attempts[0].attempt = 0))],
    ['a fractional omitted count', filing((d) => (d.omitted = 1.5))],
    [
      `more than ${MAX_REQUEST_ATTEMPT_ROWS} rows`,
      filing(
        (d) =>
          (d.attempts = Array.from({ length: MAX_REQUEST_ATTEMPT_ROWS + 1 }, (_, i) => ({
            attempt: i + 1,
            outcome: 'refused',
            reason: 'retryable',
          }))),
      ),
    ],
    ['no end', filing((d) => delete d.end)],
    ['not an object', 'retried twice'],
    ['null', null],
  ];

  for (const [what, raw] of REFUSED) {
    it(`refuses ${what}`, () => {
      expect(servedRequestEvidence(raw)).toBeUndefined();
    });
  }

  it('refuses a getter — a value is read as data, never by running code', () => {
    const raw = structuredClone(WELL_FORMED) as unknown as Record<string, unknown>;
    let ran = false;
    Object.defineProperty(raw, 'omitted', {
      enumerable: true,
      get: () => {
        ran = true;
        return 0;
      },
    });
    expect(servedRequestEvidence(raw)).toBeUndefined();
    expect(ran).toBe(false);
  });

  it('refuses a class instance in place of a plain record', () => {
    class Row {
      attempt = 1;
      outcome = 'answered';
      reason = 'answered';
    }
    expect(servedRequestEvidence(filing((d) => (d.attempts = [new Row()])))).toBeUndefined();
  });

  it('never throws — a hostile proxy is refused, not propagated', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('boom');
        },
        getPrototypeOf: () => Object.prototype,
      },
    );
    expect(() => servedRequestEvidence(hostile)).not.toThrow();
    expect(servedRequestEvidence(hostile)).toBeUndefined();
  });
});

describe('request evidence door — P1 the port on a call’s context', () => {
  const sink = { file: () => undefined };

  it('reads the port the dispatcher put on the context', () => {
    expect(requestEvidenceOf({ toolCallId: 'c', [REQUEST_EVIDENCE]: sink })).toBe(sink);
  });

  it('a context a wrapper copies (`{ ...ctx }`) keeps the port the dispatcher built', () => {
    const port = requestEvidenceFor(
      { $emit: () => undefined },
      { toolName: 't', toolCallId: 'c', iteration: 1 },
    );
    const ctx = { toolCallId: 'c', ...port };
    const sinkOf = requestEvidenceOf(ctx);
    expect(sinkOf).toBeDefined();
    expect(requestEvidenceOf({ ...ctx, extra: true })).toBe(sinkOf);
  });

  it('no port, or not a port: none — and never a throw', () => {
    expect(requestEvidenceOf(undefined)).toBeUndefined();
    expect(requestEvidenceOf({ toolCallId: 'c' })).toBeUndefined();
    expect(requestEvidenceOf({ [REQUEST_EVIDENCE]: { file: 'not a function' } })).toBeUndefined();
    expect(
      requestEvidenceOf({ [REQUEST_EVIDENCE]: { file: () => undefined, signal: 'abort' } }),
    ).toBeUndefined();
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error('boom');
        },
      },
    );
    expect(() => requestEvidenceOf(hostile)).not.toThrow();
    expect(requestEvidenceOf(hostile)).toBeUndefined();
  });
});
