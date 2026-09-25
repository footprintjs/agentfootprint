/**
 * The plain-Node shape of a held hand-over — run as its own process by
 * `turn-artifacts-process.test.ts`, under Node's DEFAULT
 * `--unhandled-rejections=throw`, where a single unhandled rejection ends the
 * process (and every session it was serving).
 *
 * The host keeps the `turn` it was handed and files AFTER the handler
 * returned — the pattern the first cut of `HostReply.turnArtifacts` documented.
 * A floating late `put` must be refused WITHOUT becoming an unhandled
 * rejection; an awaited one must still receive the named refusal. The process
 * prints what it saw and exits 0 only if it survived to the end.
 */

import { Agent, inMemoryArtifacts } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { memorySessions, standingAgent } from '../../../src/hosting/index.js';
import type { HostHandler, HostReply, TurnArtifacts } from '../../../src/hosting/index.js';

async function main(): Promise<void> {
  let handler: HostHandler | undefined;
  const host = {
    name: 'plainNode',
    capabilities: [] as const,
    serve: (incoming: HostHandler) => {
      handler = incoming;
      return Promise.resolve({ close: async () => undefined });
    },
  };
  const agent = Agent.create({
    provider: mock({ reply: 'ok' }),
    model: 'm',
    artifacts: inMemoryArtifacts(),
  }).build();
  await standingAgent({ agent, sessions: memorySessions(), host });

  let held: TurnArtifacts | undefined;
  const reply: HostReply = {
    complete: (output) => process.stdout.write(`complete:${output}\n`),
    fail: (error) => process.stdout.write(`fail:${error.message}\n`),
    turnArtifacts: (turn) => {
      held = turn;
    },
  };
  await handler?.({ input: 'hi', sessionId: 's1' }, reply);
  if (held?.bound !== true) throw new Error('expected a bound hand-over');

  // The floating late call: the crash shape.
  void held.artifacts.put({ kind: 'story/turn', mediaType: 'text/plain', data: 'late' });
  // The awaited late call: still told, by name.
  try {
    await held.artifacts.put({ kind: 'story/turn', mediaType: 'text/plain', data: 'late' });
    process.stdout.write('awaited:resolved\n');
  } catch (err) {
    process.stdout.write(`awaited:${(err as { code?: string }).code ?? String(err)}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stdout.write('SURVIVED\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`heldTurnArtifactsProcess failed: ${String(error)}\n`);
  process.exit(2);
});
