/**
 * 30 — Agent ↔ tool-server contract check (`toolContractCheckup`).
 *
 * When an agent's tools call a remote tool-server (an MCP-ish sidecar / function
 * gateway), the agent's `inputSchema` and the server's real contract can drift — the
 * model then calls a tool that 404s, or omits an arg the server REQUIRES and gets a
 * "doesn't work." The server usually publishes a catalog (`GET /tools`), so the drift
 * is checkable at build/CI time instead of surfacing as a runtime error.
 *
 * `toolContractCheckup(agentTools, serverCatalog)` is a PURE diff (no I/O — you fetch
 * the catalog and pass it). It flags:
 *   • required-divergence (ERROR) — server REQUIRES an arg the agent marks optional/omits
 *   • optional-drift      (WARN)  — server accepts an arg the agent never surfaces (lost filter)
 *   • arg-divergence      (WARN)  — agent declares an arg the server doesn't know
 *   • missing-on-server   (ERROR) — agent tool not in the catalog (would 404)
 *   • dead-endpoint       (WARN)  — server tool no agent tool calls
 *
 * Run:  npx tsx examples/features/30-tool-contract-checkup.ts
 */

import {
  defineTool,
  toolContractCheckup,
  type ServerToolEntry,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/30-tool-contract-checkup',
  title: 'Tool contract — diff agent schemas vs a server /tools catalog',
  group: 'features',
  description:
    'toolContractCheckup(agentTools, serverCatalog) is a pure diff of an agent’s tool inputSchemas against a tool-server catalog (e.g. GET /tools): required-divergence (error), optional-drift / arg-divergence / dead-endpoint / missing-on-server. Catch the "tool 404s / omits a required arg / ignores my filter" class at build time.',
  defaultInput: '(no input — static contract diff)',
  providerSlots: [],
  tags: ['feature', 'tools', 'contract', 'checkup', 'mcp'],
};

const t = (name: string, required: string[], props: string[]) =>
  defineTool({
    name,
    description: name,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])),
      required,
    },
    execute: async () => 'ok',
  });

export async function run(_input?: string, _provider?: LLMProvider): Promise<unknown> {
  // The agent's registered tools.
  const agentTools = [
    t('pmax_get_array_perf', ['array_id'], ['array_id']), //          drops the server's `window`
    t('influx_get_io_profile', ['initiator_id'], ['initiator_id', 'switch_name']), // aligned
    t('rvtools_get_vm', [], ['host', 'vm', 'datacenter']), //          fine
    t('legacy_export', [], ['fmt']), //                                not on the server
  ];

  // The server's catalog (what you'd get from `await (await fetch(`${base}/tools`)).json()`).
  const serverCatalog: ServerToolEntry[] = [
    {
      name: 'pmax_get_array_perf',
      inputSchema: { required: ['array_id'], properties: { array_id: {}, window: {} } },
    },
    {
      name: 'influx_get_io_profile',
      inputSchema: {
        required: ['initiator_id'],
        properties: { initiator_id: {}, switch_name: {} },
      },
    },
    {
      name: 'rvtools_get_vm',
      inputSchema: { required: [], properties: { host: {}, vm: {}, datacenter: {} } },
    },
    {
      name: 'influx_get_switch_inventory',
      inputSchema: { required: [], properties: { switch_name: {} } },
    }, // no agent tool
  ];

  const result = toolContractCheckup(agentTools, serverCatalog);

  return {
    ok: result.ok, // false — legacy_export is missing-on-server (an error)
    problems: result.problems.map((p) => ({ kind: p.kind, code: p.code, tool: p.tool })),
    // expected: optional-drift(pmax_get_array_perf: window), missing-on-server(legacy_export),
    //           dead-endpoint(influx_get_switch_inventory)
  };
}

if (isCliEntry(import.meta.url)) {
  void run().then(printResult);
}
