/**
 * Sample 19: Security — Permission-Gated Tools
 *
 * gatedTools hides tools from the LLM entirely. The LLM can't hallucinate
 * a tool it never saw. Two layers of defense:
 *   Layer 1: resolve-time filtering (tool hidden from LLM)
 *   Layer 2: execute-time rejection (hallucinated tool name caught)
 *
 * PermissionPolicy provides role-based access with mid-conversation upgrades.
 * PermissionRecorder produces an audit trail of blocked/denied/allowed events.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  Agent,
  defineTool,
  mock,
  gatedTools,
  PermissionPolicy,
  PermissionRecorder,
  staticTools,
} from '../../src/test-barrel';
import type { ToolCall, Message } from '../../src/test-barrel';

// ── Tools ────────────────────────────────────────────────────

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async ({ q }) => ({ content: `Results for ${q}` }),
});

const deleteTool = defineTool({
  id: 'delete_user',
  description: 'Delete a user account permanently',
  inputSchema: { type: 'object', properties: { userId: { type: 'string' } } },
  handler: async ({ userId }) => ({ content: `Deleted ${userId}` }),
});

const adminTool = defineTool({
  id: 'run_code',
  description: 'Execute arbitrary code on the server',
  inputSchema: { type: 'object', properties: { code: { type: 'string' } } },
  handler: async ({ code }) => ({ content: `Executed: ${code}` }),
});

const allTools = [searchTool, deleteTool, adminTool];

// ── Tests ────────────────────────────────────────────────────

describe('Sample 19: Security — Gated Tools', () => {
  it('gatedTools hides blocked tools from the LLM', async () => {
    const policy = new PermissionPolicy(['search']); // only search allowed

    const gated = gatedTools(staticTools(allTools), policy.checker());

    // Resolve directly to verify filtering
    const resolved = await gated.resolve({
      message: '',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    });
    const toolNames = resolved.value.map((t) => t.name);

    // Only 'search' visible — delete_user and run_code are hidden
    expect(toolNames).toEqual(['search']);
    expect(toolNames).not.toContain('delete_user');
    expect(toolNames).not.toContain('run_code');
  });

  it('PermissionPolicy.fromRoles enables role-based access', async () => {
    const policy = PermissionPolicy.fromRoles(
      {
        user: ['search'],
        admin: ['search', 'delete_user', 'run_code'],
      },
      'user',
    ); // start as user

    const gated = gatedTools(staticTools(allTools), policy.checker());

    // Resolve as user — only search visible
    const userTools = await gated.resolve({
      message: '',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    });
    expect(userTools.value.map((t) => t.name)).toEqual(['search']);

    // Upgrade to admin mid-conversation
    policy.setRole('admin');

    // Resolve as admin — all tools visible
    const adminTools = await gated.resolve({
      message: '',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    });
    expect(adminTools.value.map((t) => t.name)).toEqual(['search', 'delete_user', 'run_code']);
  });

  it('PermissionRecorder tracks blocked and allowed events', async () => {
    const policy = new PermissionPolicy(['search']);
    const recorder = new PermissionRecorder();

    const gated = gatedTools(staticTools(allTools), policy.checker(), {
      onBlocked: (toolId) => recorder.onBlocked(toolId, 'resolve'),
    });

    // Resolve — triggers blocked events for hidden tools
    await gated.resolve({ message: '', turnNumber: 0, loopIteration: 0, messages: [] });

    const summary = recorder.getSummary();
    expect(summary.blocked).toContain('delete_user');
    expect(summary.blocked).toContain('run_code');
  });
});
