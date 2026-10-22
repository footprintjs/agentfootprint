import { describe, expect, it } from 'vitest';
import {
  ProviderTimeoutError,
  isProviderTimeout,
  type ProviderTimeoutWait,
} from '../../src/provider-contract/timeout.js';
describe('shared provider timeout facts', () => {
  it.each([false, true])('derives retry advice from observed output: %s', (afterOutput) => {
    const error = new ProviderTimeoutError({
      provider: 'fixture',
      waitingFor: 'chunk',
      timeoutMs: 20,
      afterOutput,
    });
    expect(error.retryable).toBe(!afterOutput);
    expect(isProviderTimeout(error)).toBe(true);
    expect(isProviderTimeout({ ...error })).toBe(false);
    expect(isProviderTimeout({ ...error, message: error.message })).toBe(true);
    expect(error.message).not.toContain('fixture');
  });
  it.each([
    'response',
    'first-event',
    'chunk',
    'body',
    'close',
    'fallback',
  ] as ProviderTimeoutWait[])('retains the exact wait kind %s', (waitingFor) => {
    expect(
      new ProviderTimeoutError({
        provider: 'fixture',
        waitingFor,
        timeoutMs: 1,
        afterOutput: false,
      }).waitingFor,
    ).toBe(waitingFor);
  });
  it('does not run hostile fields or trust contradictory retry advice', () => {
    const read = () => {
      throw Error('getter ran');
    };
    const hostile = Object.defineProperty({}, 'code', { get: read });
    expect(isProviderTimeout(hostile)).toBe(false);
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(isProviderTimeout(proxy.proxy)).toBe(false);
    const error = new ProviderTimeoutError({
      provider: 'fixture',
      waitingFor: 'chunk',
      timeoutMs: 1,
      afterOutput: true,
    });
    expect(isProviderTimeout({ ...error, retryable: true })).toBe(false);
    expect(isProviderTimeout({ ...error, waitingFor: 'arbitrary' })).toBe(false);
    expect(isProviderTimeout({ ...error, timeoutMs: NaN })).toBe(false);
    expect(isProviderTimeout(null)).toBe(false);
  });
});
