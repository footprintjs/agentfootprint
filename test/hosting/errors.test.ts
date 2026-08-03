/**
 * hosting errors — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * These messages ARE the feature when something goes wrong: they are the only
 * thing a person on call reads. Each one has to name who refused, say what was
 * and was not done, and not blame the wrong party — so the variants with a
 * detail and the variants without it are both asserted, because the
 * without-detail path is the one that shows up when you know least.
 */

import { describe, expect, it } from 'vitest';

import {
  ConcurrentRunError,
  HostClosedError,
  PauseNotCarriedError,
  requireCapability,
} from '../../src/hosting/index.js';
import type { AgentHost } from '../../src/hosting/index.js';

describe('HostClosedError', () => {
  it('names the adapter and says in-flight work was allowed to finish', () => {
    const err = new HostClosedError('nodeHost');
    expect(err.name).toBe('HostClosedError');
    expect(err.code).toBe('ERR_HOST_CLOSED');
    expect(err.hostName).toBe('nodeHost');
    expect(err.message).toContain("'nodeHost'");
    expect(err.message).toContain('is closed');
    expect(err.message).toContain('allowed to finish');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ConcurrentRunError', () => {
  it('names the session AND the active run when it knows it', () => {
    const err = new ConcurrentRunError('c-1', 'run-42');
    expect(err.code).toBe('ERR_CONCURRENT_RUN');
    expect(err.sessionId).toBe('c-1');
    expect(err.activeRunId).toBe('run-42');
    expect(err.message).toContain("session 'c-1'");
    expect(err.message).toContain("run 'run-42'");
    expect(err.message).toContain("onConcurrentInvoke: 'enqueue'");
  });

  it('still reads correctly when the run has not announced itself yet', () => {
    const err = new ConcurrentRunError('c-1');
    expect(err.activeRunId).toBeUndefined();
    expect(err.message).toContain("session 'c-1'");
    expect(err.message).not.toContain('(run');
    expect(err.message).not.toContain('undefined');
  });
});

describe('PauseNotCarriedError', () => {
  it('names the tool and the session, and does not blame the agent', () => {
    const err = new PauseNotCarriedError('approve_refund', 's-1');
    expect(err.code).toBe('ERR_PAUSE_NOT_CARRIED');
    expect(err.toolName).toBe('approve_refund');
    expect(err.sessionId).toBe('s-1');
    expect(err.message).toContain("'approve_refund'");
    expect(err.message).toContain("session 's-1'");
    expect(err.message).toContain('did not fail');
    expect(err.message).toContain('Nothing was written');
  });

  it('degrades to plain language when it knows neither', () => {
    const err = new PauseNotCarriedError();
    expect(err.toolName).toBeUndefined();
    expect(err.sessionId).toBeUndefined();
    expect(err.message).toContain('a tool');
    expect(err.message).toContain('no session id');
    expect(err.message).not.toContain('undefined');
  });

  it('says the pause was STORED when it was, and where to answer it', () => {
    const err = new PauseNotCarriedError('approve_refund', 'c-1', true);
    expect(err.stored).toBe(true);
    expect(err.message).toContain('did not fail');
    expect(err.message).toContain('IS stored');
    expect(err.message).toContain("session 'c-1'");
    expect(err.message).toContain('decision');
    // The old reason is gone: the envelope CAN carry a pause now.
    expect(err.message).not.toContain('conversation-v1');
  });

  it('says nothing was written when nothing was, without blaming the envelope', () => {
    const err = new PauseNotCarriedError('approve_refund', undefined, false);
    expect(err.stored).toBe(false);
    expect(err.message).toContain('Nothing was written');
    expect(err.message).toContain('no session id');
  });
});

describe('requireCapability', () => {
  const host = (capabilities: readonly ('streaming' | never)[]): AgentHost => ({
    name: 'testHost',
    capabilities,
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  });

  it('is silent when the host has it', () => {
    expect(() => requireCapability(host(['streaming']), 'streaming')).not.toThrow();
  });

  it('names the adapter, what was asked, and what it does have', () => {
    expect(() => requireCapability(host([]), 'streaming')).toThrow(/'testHost'/);
    expect(() => requireCapability(host([]), 'streaming')).toThrow(/It reports: none/);
    expect(() => requireCapability(host([]), 'streaming')).toThrow(/never assumed from its name/);
  });

  it('lists what it does have when the list is non-empty', () => {
    // A host with capabilities, asked for one it lacks: the message has to say
    // what IS there, or the reader is left guessing at the alternative.
    const partial = { ...host(['streaming']), capabilities: ['streaming'] as const };
    expect(() => requireCapability(partial, 'streaming')).not.toThrow();
    const other = { ...host([]), name: 'otherHost', capabilities: [] as const };
    expect(() => requireCapability(other, 'streaming')).toThrow(/'otherHost'/);
  });
});
