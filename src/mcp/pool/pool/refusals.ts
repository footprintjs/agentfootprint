import { McpPoolRefusedError } from '../errors.js';

/** The reason an open is aborted at its deadline — a fixed sentence. */
export function initTimeout(): Error {
  return Object.assign(new Error('The pooled client did not open within its deadline.'), {
    name: 'TimeoutError',
  });
}

/** The reason in-flight work is aborted when the pool closes — a fixed sentence. */
export function poolClosed(): Error {
  return Object.assign(new Error('The MCP client pool was closed.'), { name: 'AbortError' });
}

/** A listing refused at its send because the app's names moved: listed again under the new context. */
export function isContextMoved(error: unknown): boolean {
  return error instanceof McpPoolRefusedError && error.reason === 'binding-changed';
}
