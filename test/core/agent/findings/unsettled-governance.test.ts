/**
 * Regression — the leak probe from the rule's second review, copied into the
 * suite with its assertions turned around (9.113.0, `findings/unsettled.ts`).
 *
 * Pattern: Test-as-specification, scenario style: the probe as the review
 *          wrote it — the same two tools, script and after-tool rules, on
 *          both chart shapes, over a scripted provider that keeps every
 *          request it was handed.
 * Role:    Pin "governance wins": nothing an after-tool `deny` or scrub
 *          withheld ever reaches the model through a library-composed piece.
 *          The dispatch door records what a tool RETURNED, before the
 *          after-tool chain runs. The rule's first cut took the row's lists
 *          from those records, so a ruling-out on a denied result filed a
 *          row and the next call's system prompt quoted the envelope's
 *          `not_checked` — a word the deny had kept from the model — under
 *          `ruled out (…) on an absence`; a scrub that took `not_checked`
 *          out was undone the same way. The probe asserted the leak; this
 *          file asserts its absence:
 *
 *   • a deny: call 2 reads the deny sentence for c1; call 3's system prompt
 *     holds the model's own ruled-out line as declared and no section — no
 *     withheld word, no "on an absence" the model never read; the ledger
 *     holds the model's word and nothing beside it; no request carries the
 *     withheld word;
 *   • a scrub: call 2 reads the envelope without its `not_checked`; call 3
 *     is served the section worded from what was served (its `cannot_cover`
 *     and `try_instead`), never the scrubbed word.
 *
 * The same law at the answer moment and on a continued turn is pinned in
 * `unsettled.test.ts` (§ 4, "the model must have been SERVED the absence").
 *
 * Test types (Convention 3): regression (the review's probe) / integration
 * (real runs on both chart shapes).
 */

import { describe, expect, it } from 'vitest';

import {
  absent,
  Agent,
  allow,
  defineTool,
  deny,
  type FindingsRow,
  type ToolMiddleware,
} from '../../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../../src/adapters/types.js';

/** The word an after-tool rule keeps from the model — unique, so a leak anywhere on the wire shows. */
const WITHHELD = 'SECRET-internal-collector-host-db7.corp';

/** The miss c1 returns: an absence whose `not_checked` names the withheld word. */
const HBA_MISS = {
  what: 'HBAs on host nas-cluster-06',
  checked: ['the HBA table of every collected hypervisor host'],
  notChecked: [
    {
      what: WITHHELD,
      why: 'this lookup reads HBA rows, never the host inventory',
    },
  ],
  cannotCover: [
    {
      what: 'HBAs on hosts outside the collected inventory',
      why: 'the collector exports only the hosts it was pointed at',
    },
  ],
  tryInstead: 'Look nas-cluster-06 up in cluster_inventory.',
};

const DENY_SENTENCE = 'HBA data is withheld for this user.';

type Reply = {
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
};

/** A provider that answers from a script and keeps every request it saw. */
function scripted(script: readonly Reply[]) {
  const wire: LLMRequest[] = [];
  let i = 0;
  return {
    wire,
    provider: {
      name: 'leak-probe-mock',
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        wire.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
        i += 1;
        const toolCalls = reply.toolCalls ?? [];
        return {
          content: reply.content,
          toolCalls,
          usage: { input: 0, output: 0 },
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
        };
      },
    },
  };
}

const call = (id: string, name: string, args: Record<string, unknown> = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
const answer = (content: string): Reply => ({ content });

/** c1 looks the HBAs up; c2's `_findings` rules c1 out; then the answer. */
const SCRIPT: readonly Reply[] = [
  call('c1', 'host_hbas', { host: 'nas-cluster-06' }),
  call('c2', 'cluster_inventory', {
    name: 'nas-cluster-06',
    _findings: {
      basis: 'direct',
      previous: [{ toolCallId: 'c1', standing: 'ruled-out', line: 'could not read the HBAs' }],
    },
  }),
  answer('not settled'),
];

async function runWith(rule: ToolMiddleware, reactMode: 'dynamic' | 'dynamic-grouped') {
  const { provider, wire } = scripted(SCRIPT);
  const agent = Agent.create({
    provider: provider as never,
    model: 'mock',
    maxIterations: 8,
    reactMode,
  })
    .system('bot')
    .tool(
      defineTool({
        name: 'host_hbas',
        description: 'hbas',
        inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
        execute: () => absent(HBA_MISS),
      } as never),
    )
    .tool(
      defineTool({
        name: 'cluster_inventory',
        description: 'clusters',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        execute: () => [{ cluster: 'nas-cluster-06' }],
      } as never),
    )
    .findings()
    .toolMiddleware(rule)
    .build();
  await agent.run({ message: 'is nas-cluster-06 slow?' });
  return { ledger: (agent.findings() ?? []) as readonly FindingsRow[], wire };
}

/** The tool message one request carried for one call. */
const toolMsg = (req: LLMRequest, id: string): string | undefined =>
  req.messages.find((m) => m.role === 'tool' && m.toolCallId === id)?.content;

describe('unsettled by absence — the review’s leak probe: after-tool governance vs the unsettled section', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: an after-tool DENY ("do not let the model see it") — the section re-serves nothing of the envelope`, async () => {
      const { ledger, wire } = await runWith(
        {
          name: 'hba-governance',
          onToolResult: (c) => (c.toolName === 'host_hbas' ? deny(DENY_SENTENCE) : allow()),
        },
        reactMode,
      );
      // Call 2 read the deny sentence for c1 — the whole of what the model got.
      expect(toolMsg(wire[1]!, 'c1')).toBe(DENY_SENTENCE);
      // Call 3, the first served after the ruling-out: the model's own line as
      // declared, and nothing the rule withheld — no envelope word, and no
      // "on an absence" the model never read.
      const sys3 = wire[2]!.systemPrompt ?? '';
      expect(sys3).toContain('\nruled out (host_hbas, tool:c1): could not read the HBAs\n');
      expect(sys3).not.toContain(WITHHELD);
      expect(sys3).not.toContain('on an absence');
      expect(sys3).not.toContain('unsettled by absence');
      // On the record, the model's word and nothing beside it; on the wire,
      // the withheld word nowhere.
      expect(ledger.map((row) => row.kind)).toEqual(['standing', 'basis']);
      expect(JSON.stringify(wire)).not.toContain(WITHHELD);
    });

    it(`${reactMode}: an after-tool allow(value, why) SCRUB of not_checked — the section never re-serves the scrubbed words`, async () => {
      const { ledger, wire } = await runWith(
        {
          name: 'scrub',
          onToolResult: (c) => {
            if (c.toolName !== 'host_hbas') return allow();
            const { not_checked: _drop, ...rest } = c.result as Record<string, unknown>;
            return allow(rest, 'internal collector host names are not shown to the model');
          },
        },
        reactMode,
      );
      // Call 2 read the envelope without its `not_checked` — still an absence.
      const served1 = toolMsg(wire[1]!, 'c1') ?? '';
      expect(served1).toContain('"af_absent":true');
      expect(served1).not.toContain(WITHHELD);
      // Call 3 is served the section worded from what was SERVED: the scrub
      // is honored, neither undone nor a reason to drop the row.
      const sys3 = wire[2]!.systemPrompt ?? '';
      expect(sys3).not.toContain(WITHHELD);
      expect(sys3).toContain(
        [
          'unsettled by absence (read off the record):',
          'ruled out (host_hbas, tool:c1) on an absence',
          'tool:c1 cannot_cover: HBAs on hosts outside the collected inventory — the collector exports only the hosts it was pointed at',
          'tool:c1 try_instead: Look nas-cluster-06 up in cluster_inventory.',
        ].join('\n') + '\n\n',
      );
      expect(ledger.find((row) => row.kind === 'unsettled-by-absence')).toEqual({
        kind: 'unsettled-by-absence',
        toolCallId: 'c1',
        cannotCover: HBA_MISS.cannotCover,
        tryInstead: HBA_MISS.tryInstead,
        iteration: 2,
      });
      expect(JSON.stringify(wire)).not.toContain(WITHHELD);
    });
  }
});
