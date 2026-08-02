/**
 * The tools the real-transport fixtures serve.
 *
 * Imported by BOTH sides on purpose: the child-process entry that gets
 * bundled and spawned (`stdioServerEntry.ts`), and the tests that assert
 * what came back over the wire. "The schema arrived unchanged" is only a
 * real claim when both ends read the same source of truth.
 *
 * This module must stay side-effect free — importing it must never start
 * a server, or the test process itself would try to speak MCP on its own
 * stdout.
 */

import { defineTool } from '../../../../src/index.js';
import { PermissionPolicy } from '../../../../src/security/index.js';
import type { Tool } from '../../../../src/core/tools.js';

export const ECHO_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
};

export const DELETE_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
};

/** What the client must see when the permission check refuses the call. */
export const DENIAL_MESSAGE = "denied: 'delete_account' is not permitted for role 'readonly'";

/**
 * Build the served tools. A function rather than a constant so the child
 * process and the test each get their own instances — nothing is shared
 * across the process boundary except the schemas above.
 */
export function servedTools(): Tool[] {
  // The consumer's own governance. It lives INSIDE `execute`, which is
  // exactly the thing serving over MCP must not be able to route around.
  const policy = PermissionPolicy.fromRoles(
    { readonly: ['echo'], admin: ['echo', 'delete_account'] },
    'readonly',
  );

  const echo = defineTool<{ text: string }, string>({
    name: 'echo',
    description: 'Echo the input back',
    inputSchema: ECHO_INPUT_SCHEMA,
    execute: ({ text }) => `echo: ${text}`,
  });

  const deleteAccount = defineTool<{ id: string }, string>({
    name: 'delete_account',
    description: 'Delete an account permanently',
    inputSchema: DELETE_INPUT_SCHEMA,
    execute: ({ id }) => {
      if (!policy.isAllowed('delete_account')) throw new Error(DENIAL_MESSAGE);
      return `deleted ${id}`;
    },
  });

  return [echo, deleteAccount];
}
