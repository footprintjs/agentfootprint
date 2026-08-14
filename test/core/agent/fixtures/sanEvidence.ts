/**
 * Realistic SAN fixtures for the evidence gate (9.35.0).
 *
 * The shapes are taken from a real consumer app's mock tool layer (56 tools
 * over Cisco MDS / RVTools / vROps data): WWNs like
 * `21:00:00:24:ff:4a:12:03`, FCIDs like `0xe00200`, device aliases like
 * `stor-array05-ct1-fc0`, IOPS with thousands separators, ESXi versions,
 * chassis serials, timestamps and dBm readings.
 *
 * `CORRECT_ANSWERS` are answers an engineer would accept, written the way a
 * model writes them — thousands separators, units, ordinals, markdown, prose
 * numerals. **Every one of them must pass the gate.** They are the
 * false-positive measurement, and the measurement is the feature: a check that
 * flags good answers makes a weak model loop, which is the failure this
 * library exists to remove.
 *
 * `FABRICATED_ANSWERS` carry the field-observed invention — the port row with
 * alias `SHPMAXDLVAP001-FA0` and FCID `0xef0101`, neither of which appears in
 * any tool result — plus siblings of it.
 */

/** Tool results, as the model reads them: JSON text under `role: 'tool'`. */
export const TOOL_RESULTS: Readonly<Record<string, unknown>> = {
  show_interface_status: {
    switch: 'lva1-mds01',
    total_ports: 48,
    up: 47,
    down: 1,
    ports: [
      {
        interface: 'fc1/1',
        oper_status: 'up',
        mode: 'F',
        speed: '32G',
        vsan: 100,
        device: 'stor-array05-ct0-fc0',
      },
      {
        interface: 'fc1/3',
        oper_status: 'down',
        mode: 'F',
        speed: 'auto',
        vsan: 100,
        device: 'stor-array05-ct1-fc0',
        down_reason: 'link_failure',
      },
      {
        interface: 'fc1/5',
        oper_status: 'up',
        mode: 'F',
        speed: '32G',
        vsan: 100,
        device: 'esxi-host10-hba0',
      },
    ],
  },
  show_flogi: {
    switch: 'lva1-mds01',
    entries: [
      {
        interface: 'fc1/1',
        fcid: '0x650000',
        port_wwn: '21:00:00:24:ff:4a:12:01',
        device_alias: 'stor-array05-ct0-fc0',
      },
      {
        interface: 'fc1/5',
        fcid: '0x650400',
        port_wwn: '50:00:09:72:08:60:2a:00',
        device_alias: 'esxi-host10-hba0',
      },
    ],
    note: 'fc1/3 has no active FLOGI — device 21:00:00:24:ff:4a:12:03 is not logged in.',
  },
  show_interface_counters: {
    interface: 'fc1/3',
    switch: 'lva1-mds01',
    crc: 892,
    link_failures: 47,
    signal_loss: 3,
    itw: 1204,
    last_state_change: '2026-04-12T08:15:00Z',
  },
  show_sfp_diagnostics: {
    interface: 'fc1/3',
    rx_power_dbm: -14.8,
    tx_power_dbm: -3.1,
    temp_c: 58,
    verdict: 'Rx power -14.8 dBm is NEAR THRESHOLD (-15 dBm) — degraded optics',
  },
  io_profile: {
    switch: 'lva1-mds01',
    initiator_id: '0x650400',
    window: '24h',
    summary: { avg_iops: 18450, peak_iops: 41200, avg_mbps: 612, read_pct: 78 },
    busiest_hours: ['09:00', '10:00', '11:00'],
  },
  rvtools_host_details: {
    host: 'esxi-host10.lvn.example.com',
    hosts: [
      {
        Host: 'esxi-host10.lvn.example.com',
        Cluster: 'LVN-PROD',
        Model: 'UCSB-B200-M5',
        Serial_number: 'FCH1234V5K6',
        ESX_Version: 'VMware ESXi 7.0.3',
        num_Memory: 786432,
        num_VMs: 22,
      },
    ],
  },
  rvtools_vm_disks: {
    vm: 'app-sql-01',
    disks: [
      {
        VM: 'app-sql-01',
        Disk_Path: '[ds_epic_prod_01] app-sql-01/app-sql-01_1.vmdk',
        capacity_gb: 2048.0,
        is_rdm: true,
        naa: '02003700006000097000019760183353303031313753594d4d4554',
      },
    ],
  },
};

/** The tool results as the loop stores them — one JSON string per call. */
export const toolMessages = (
  names: readonly string[] = Object.keys(TOOL_RESULTS),
): ReadonlyArray<{ role: 'tool'; content: string; toolName: string; toolCallId: string }> =>
  names.map((name, i) => ({
    role: 'tool' as const,
    content: JSON.stringify(TOOL_RESULTS[name]),
    toolName: name,
    toolCallId: `c${i}`,
  }));

/**
 * Answers that are CORRECT for this data and must not trip the gate.
 *
 * Deliberately varied in style: prose numerals, thousands separators, units
 * glued to numbers, ordinals, markdown tables, bullet lists, percentages,
 * negative decimals, a version string, a timestamp, a hostname, a capacity
 * with a `.0`, and the "I don't have that" answer the gate is supposed to
 * make more likely.
 */
export const CORRECT_ANSWERS: readonly string[] = [
  // 1 — the plain diagnosis
  'Port fc1/3 on lva1-mds01 is down with reason link_failure. It is the only ' +
    'one of the 48 ports that is down; the other 47 are up.',
  // 2 — numbers in prose, small integers, units glued on
  'I checked 3 things. The port has 892 CRC errors and 47 link failures over ' +
    'the last 24h window, and it negotiated at 32G before it dropped.',
  // 3 — thousands separator vs a JSON number
  'The initiator peaks at 41,200 IOPS with an average of 18,450 IOPS and ' +
    '612 MBps of throughput. Reads are 78% of the profile.',
  // 4 — WWNs, FCIDs, aliases
  'The device on fc1/3 is stor-array05-ct1-fc0 (WWPN 21:00:00:24:ff:4a:12:03). ' +
    'It has no FLOGI. The healthy neighbour fc1/5 is logged in as FCID ' +
    '0x650400 with WWPN 50:00:09:72:08:60:2a:00.',
  // 5 — a markdown table, the shape a model reaches for
  `| interface | status | device |\n` +
    `| --- | --- | --- |\n` +
    `| fc1/1 | up | stor-array05-ct0-fc0 |\n` +
    `| fc1/3 | down | stor-array05-ct1-fc0 |\n` +
    `| fc1/5 | up | esxi-host10-hba0 |`,
  // 6 — negative decimals, a threshold, a temperature, an ordinal
  'Rx power is -14.8 dBm, which is the 1st reading under the -15 dBm ' +
    'threshold; the transceiver runs at 58 C and Tx is -3.1 dBm. This is the ' +
    '47th flap.',
  // 7 — timestamps, ISO dates, clock times
  'The last state change was at 2026-04-12T08:15:00Z. Traffic peaks at 09:00, ' +
    '10:00 and 11:00 each day.',
  // 8 — host inventory: hostname, model, serial, version, a big number
  'The host is esxi-host10.lvn.example.com in cluster LVN-PROD, a ' +
    'UCSB-B200-M5 with serial FCH1234V5K6 running VMware ESXi 7.0.3. It has ' +
    '786432 MB of memory and 22 VMs.',
  // 9 — a capacity written with a trailing .0, a long NAA id, a datastore path
  'app-sql-01 has a 2048.0 GB RDM at ' +
    '[ds_epic_prod_01] app-sql-01/app-sql-01_1.vmdk, naa ' +
    '02003700006000097000019760183353303031313753594d4d4554.',
  // 10 — the honest refusal the gate is meant to encourage
  'I do not have optics data for fc1/1 — the only SFP diagnostics I collected ' +
    'were for fc1/3. I would need to run the diagnostic on that port before ' +
    'saying anything about it.',
  // 11 — a summary with ordinary prose quantities and a ratio
  'Three of the five checks came back clean. The switch has been monitored ' +
    '24/7 for the last 2 days, and 1 of 48 ports is affected — about 2% of ' +
    'the fabric.',
  // 12 — a plan, all prose, no data at all
  'Next steps: replace the transceiver, clear the counters, then watch the ' +
    'port for one hour before returning it to service.',
];

/**
 * Answers carrying values that appear in NO tool result. Every one must be
 * caught, and the FIRST is the row observed in the field.
 */
export const FABRICATED_ANSWERS: ReadonlyArray<{
  readonly answer: string;
  readonly mustFlag: readonly string[];
}> = [
  {
    // The field case: an entire port row invented, alias and FCID both.
    answer:
      'Port fc1/3 is down. The affected array port is SHPMAXDLVAP001-FA0 with ' +
      'FCID 0xef0101, logged into VSAN 100.',
    mustFlag: ['shpmaxdlvap001-fa0', '0xef0101'],
  },
  {
    // A plausible neighbour WWN that was never returned.
    answer: 'The peer WWPN is 21:00:00:24:ff:4a:12:99, still logged in.',
    mustFlag: ['21:00:00:24:ff:4a:12:99'],
  },
  {
    // A measurement nobody measured: five digits, no unit.
    answer: 'The port is pushing 52700 IOPS right now, well above its average.',
    mustFlag: ['52700'],
  },
  {
    // A real port with an invented serial.
    answer: 'fc1/3 sits on chassis serial FCH9999X1Y2 in cluster LVN-PROD.',
    mustFlag: ['fch9999x1y2'],
  },
];
