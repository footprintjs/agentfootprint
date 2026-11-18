import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  withSourceEvidence,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';
import type { CredentialProvider } from '../../src/identity/types.js';
import { pausedRequest } from '../helpers/pausedRequest.js';

describe('source evidence on actual resumed dispatch', () => {
  it.each(['check-in', 'ask', 'credential'] as const)(
    'retains actual execution after %s approval on a fresh Agent',
    async (mode) => {
      let executed = 0,
        granted = false;
      const store = inMemoryArtifacts();
      const credentials: CredentialProvider = {
        id: 'fixture-vault',
        getCredential: async () =>
          granted
            ? { status: 'issued', credential: { kind: 'fixture', toHeaders: () => ({}) } }
            : {
                status: 'authorization-required',
                authorizationUrl: 'https://example.test/authorize',
                sessionId: 'fixture',
              },
      };
      const build = () => {
        const tool = withSourceEvidence(
          defineTool({
            name: 'source',
            description: 'Read fixture.',
            ...(mode === 'check-in' && { checkIn: 'always' as const }),
            ...(mode === 'credential' && {
              needs: { credential: 'fixture', mode: 'user' as const },
            }),
            execute: async () => {
              executed++;
              return { array: 'fixture-array' };
            },
          }),
          {
            describe: (served) => [
              {
                subject: { kind: 'array', value: served.array },
                operation: 'inventory',
                scope: {},
              },
            ],
          },
        );
        const provider = mock({
          respond: (request) =>
            request.messages.at(-1)?.role === 'tool'
              ? 'Done.'
              : { toolCalls: [{ id: 'source', name: 'source', args: {} }] },
        });
        const builder = Agent.create({
          provider,
          model: 'mock',
          artifacts: store,
          ...(mode === 'credential' && { credentials }),
        })
          .tool(tool)
          .sourceEvidence({ admit: (candidate) => candidate });
        if (mode === 'ask')
          builder.toolMiddleware({
            name: 'fixture-consent',
            onToolCall: () => ask({ question: 'Allow this read?' }),
            onToolResult: () => allow(),
          });
        return builder.build();
      };
      const first = build();
      const paused = await first.run({
        message: 'Read.',
        identity: { conversationId: `resume-${mode}` },
      });
      if (!isPaused(paused)) return expect.fail('Expected native consent pause.');
      expect(executed).toBe(0);
      granted = true;
      const resumed = build();
      await resumed.resume(
        JSON.parse(JSON.stringify(paused.checkpoint)),
        mode === 'credential'
          ? undefined
          : checkInApproved({ request: pausedRequest(paused), by: 'fixture-person' }),
      );
      expect(executed).toBe(1);
      expect(resumed.checkpoint()?.sourceEvidence?.refs).toHaveLength(1);
      expect(JSON.stringify(resumed.checkpoint()?.sourceEvidence)).not.toContain('fixture-array');
    },
  );
});
