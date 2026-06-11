/**
 * Neo SAN-operations tool catalog — the RFC-002 acceptance fixture.
 *
 * A representative subset (16 of 29) of the real catalog served by
 * neo-agentfootprint's `py-tools/server.py` (`GET /tools`). Kept verbatim
 * (names, descriptions, inputSchemas) so the lint exercises REAL field
 * conditions, including:
 *
 *  - the deliberately TWINNED pairs — NX-API vs InfluxDB variants of the
 *    same database lookups (`get_fcns_database` vs `influx_get_fcns_database`,
 *    `get_flogi_database` vs `influx_get_flogi_database`,
 *    `get_interface_counters` vs `influx_get_interface_counters`). RFC-002 §7:
 *    if the lint doesn't flag the fcns twins, the threshold is wrong.
 *  - the `metric` enum-in-prose case on `influx_get_port_ranking`
 *    ("avg_iops | peak_iops | mbps" — pipe-separated literals that belong
 *    in a JSON-Schema `enum`).
 *  - optional params whose omission means "fabric-wide sweep" but whose
 *    schema never says so (`influx_get_interface_counters.switch_name`).
 */

import type { CatalogTool } from '../../src/observe.js';

export const neoToolCatalog: readonly CatalogTool[] = [
  // ── Interface-triage spine (NX-API, live switch state) ──────────────
  {
    name: 'get_interface_status',
    description:
      'Blast radius — all interface status for a switch (up/down/mode/speed/device). Call FIRST.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'MDS switch hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'get_flogi_database',
    description:
      'Fabric Login (FLOGI) DB — which WWPN/FCID is logged into which port. A missing port = device dropped.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'MDS switch hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'get_interface_counters',
    description:
      'Error counters for ONE interface — CRC, link failures, signal loss, sync loss, ITW, credit loss.',
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'MDS switch hostname' },
        interface: { type: 'string', description: 'FC interface, e.g. fc1/3' },
      },
      required: ['hostname', 'interface'],
    },
  },
  {
    name: 'get_fcns_database',
    description:
      'FC Name Server (FCNS) DB — registered N_Ports in the fabric. Confirms a device is gone fabric-wide.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'MDS switch hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'get_device_health',
    description:
      'Switch health — CPU, memory, modules, PSU, fans, temperature. Rules out a system-wide fault.',
    inputSchema: {
      type: 'object',
      properties: { hostname: { type: 'string', description: 'MDS switch hostname' } },
      required: ['hostname'],
    },
  },
  {
    name: 'load_show_tech',
    description:
      'FALLBACK evidence from pre-collected show-tech — includes SFP diagnostics (Rx/Tx power). May be stale.',
    inputSchema: {
      type: 'object',
      properties: {
        hostname: { type: 'string' },
        section: { type: 'string', description: 'e.g. interfaces' },
      },
      required: ['hostname', 'section'],
    },
  },

  // ── IO-profile flow (InfluxDB time-series) ──────────────────────────
  {
    name: 'influx_get_flogi_database',
    description:
      'FLOGI DB (time-series) — resolve a port to its FCID + WWPN. Feeds io_profile + alias/host lookups.',
    inputSchema: {
      type: 'object',
      properties: { switch_name: { type: 'string' }, interface: { type: 'string' } },
      required: ['interface'],
    },
  },
  {
    name: 'influx_get_io_profile',
    description:
      'IO workload profile (hourly IOPS / throughput / read-write ratio / busy hours) for an initiator FCID.',
    inputSchema: {
      type: 'object',
      properties: { initiator_id: { type: 'string' }, switch_name: { type: 'string' } },
      required: ['initiator_id'],
    },
  },
  {
    name: 'rvtools_get_esxi_host_by_wwpn',
    description:
      'Identify the ESXi host that owns an HBA WWPN and list its VMs — the ONLY reliable ESXi confirmation.',
    inputSchema: {
      type: 'object',
      properties: { wwpn: { type: 'string' } },
      required: ['wwpn'],
    },
  },

  // ── InfluxDB time-series sweeps ──────────────────────────────────────
  {
    name: 'influx_get_interface_counters',
    description:
      'Fabric-wide interface error counters (time-series) — CRC / link-fail / signal-loss / sync-loss / ITW / credit-loss. Surfaces every port with non-zero errors.',
    inputSchema: {
      type: 'object',
      properties: {
        switch_name: { type: 'string' },
        window: { type: 'string', description: 'lookback window, e.g. 1h, 24h' },
      },
      required: [],
    },
  },
  {
    name: 'influx_get_sfp_diagnostics',
    description:
      'SFP/transceiver DOM diagnostics (time-series) — Rx/Tx power, temp, voltage vs warn/alarm thresholds. Correlates physical errors to degraded optics.',
    inputSchema: {
      type: 'object',
      properties: {
        switch_name: { type: 'string' },
        interface: { type: 'string', description: 'optional — limit to one port' },
        window: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'influx_get_fcns_database',
    description:
      'FC Name Server registrations (time-series) — every registered N_Port with its FC-4 type (initiator vs target) and alias.',
    inputSchema: {
      type: 'object',
      properties: { switch_name: { type: 'string' }, vsan: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'influx_get_port_ranking',
    description:
      'Rank ports by IOPS/throughput (time-series) — find the busiest port to drill into.',
    inputSchema: {
      type: 'object',
      properties: {
        switch_name: { type: 'string' },
        metric: { type: 'string', description: 'avg_iops | peak_iops | mbps' },
        window: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'influx_get_lun_iops',
    description:
      'Per-LUN IOPS breakdown (time-series) for an initiator FCID — which LUN/volume is busiest, read %, latency.',
    inputSchema: {
      type: 'object',
      properties: {
        initiator_id: { type: 'string', description: 'FCID resolved from FLOGI' },
        switch_name: { type: 'string' },
        window: { type: 'string' },
      },
      required: ['initiator_id'],
    },
  },

  // ── PowerMax performance drill ───────────────────────────────────────
  {
    name: 'pmax_get_array_perf',
    description:
      'PowerMax array-level performance — total/read/write IOPS, throughput, latency, cache-hit %, CPU busy. Top-level saturation check.',
    inputSchema: {
      type: 'object',
      properties: {
        array_id: { type: 'string', description: 'PowerMax array serial, e.g. 000197900123' },
        window: { type: 'string', description: 'lookback window, e.g. 1h, 24h' },
      },
      required: ['array_id'],
    },
  },
  {
    name: 'pmax_get_port_perf',
    description:
      'PowerMax FA (front-end) port performance — per-port IOPS, MB/s, utilization, latency. Finds a hot/saturated array port.',
    inputSchema: {
      type: 'object',
      properties: {
        array_id: { type: 'string', description: 'PowerMax array serial, e.g. 000197900123' },
        window: { type: 'string', description: 'lookback window, e.g. 1h, 24h' },
      },
      required: ['array_id'],
    },
  },
];
