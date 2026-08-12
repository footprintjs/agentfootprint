/**
 * 22 — File a bug with the run attached.
 *
 * A bug report IS the evidence. Instead of a person's memory of what the agent
 * did, the report carries the run: the timeline, the state, the chart, the
 * transcript — as named files in a real zip.
 *
 * The flow has TWO steps, and the first one is the point:
 *
 *   describeBugReport(input)   "here is what would be sent" — selectable units
 *                              with sizes, event and turn counts, the redacted
 *                              keys BY NAME, the total, and trim hints if it is
 *                              too big. This is what a consent dialog shows.
 *   exportBugReport(input, …)  "send exactly these" — the units the reporter
 *                              ticked, and nothing else. What they left out is
 *                              COUNTED in the manifest, so a maintainer never
 *                              mistakes a subset for the whole run.
 *
 * Then `githubBugReporter` commits the zip and files the issue — optionally
 * into TWO repos: the issue in the public one, the evidence in a private one.
 *
 * This example runs the whole path for real and checks it: two recorded
 * conversations, a manifest, a selection that drops one of them, a zip whose
 * central directory is parsed back, and a filing against a scripted GitHub
 * through the `_fetch` seam. It exits non-zero if any of that stops being true.
 *
 * Offline + deterministic: mock provider, no API key, no network, no token.
 *
 * Run:  npx tsx examples/observability/22-file-a-bug.ts
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import {
  describeBugReport,
  exportBugReport,
  githubBugReporter,
  recordRun,
  type Recording,
} from '../../src/doors/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/22-file-a-bug',
  title: 'File a bug with the run attached',
  group: 'observability',
  description:
    'describeBugReport() measures the run into selectable units (sizes, counts, redacted keys ' +
    'by name) so a human can consent; exportBugReport() bundles only what they kept, as named ' +
    'files plus a real store-only zip; githubBugReporter() commits the evidence and files the ' +
    'issue — optionally into a different repo from the issue.',
  defaultInput: 'what is the price of A-1?',
  providerSlots: [],
  tags: ['observability', 'bug-report', 'evidence', 'consent', 'github', 'zip'],
};

/** One recorded turn of a real (mock-backed) agent. */
async function recordOneTurn(message: string, sessionId: string): Promise<Recording> {
  let call = 0;
  const provider = mock({
    respond: () => {
      call++;
      return call === 1
        ? {
            content: 'looking it up',
            toolCalls: [{ id: 't1', name: 'get_price', args: { sku: 'A-1' } }],
            stopReason: 'tool_use',
          }
        : { content: 'the price is 42', toolCalls: [], stopReason: 'stop' };
    },
  });

  const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
    .system('You are a pricing assistant.')
    .tools([
      defineTool({
        name: 'get_price',
        description: 'current price for a sku',
        inputSchema: { type: 'object', properties: { sku: { type: 'string' } } },
        execute: async () => ({ price: 42 }),
      }),
    ])
    .build();

  const recorder = recordRun(agent); // BEFORE the run — always
  await agent.run({ message }, { sessionId });
  const recording = recorder.toRecording();
  recorder.stop();
  return recording;
}

/** The entry names in a zip, read out of its central directory. */
function namesInZip(archive: Uint8Array): string[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  for (let at = archive.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(at + 28, true);
    names.push(decoder.decode(archive.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return names;
}

export async function run(input: string): Promise<unknown> {
  const failures: string[] = [];
  const check = (ok: boolean, what: string): void => {
    if (!ok) failures.push(what);
  };

  // Two conversations: the one that went wrong, and an unrelated one.
  const broken = await recordOneTurn(input, 'session-broken');
  const unrelated = await recordOneTurn('and what about B-2?', 'session-unrelated');

  // ── STEP 1: measure. Nothing has left yet. ───────────────────────────
  const offer = describeBugReport([broken, unrelated]);
  console.log('What would be sent:\n');
  for (const unit of offer.units) {
    console.log(`  [ ] ${unit.id.padEnd(18)} ${(unit.bytes / 1024).toFixed(1)} KB  ${unit.label}`);
  }
  console.log(
    `\n  total ${(offer.totalBytes / 1024).toFixed(1)} KB · ` +
      `${offer.counts.events} events · ${offer.counts.turns} turns · ` +
      `redacted keys: ${offer.redactedKeys.length > 0 ? offer.redactedKeys.join(', ') : 'none'}\n`,
  );
  check(offer.units.filter((unit) => unit.kind === 'conversation').length === 2, 'two conversations');
  check(offer.oversize === undefined, 'a small bundle is not flagged oversize');

  // ── STEP 2: the reporter ticks a subset. ─────────────────────────────
  const consented = offer.units
    .filter((unit) => unit.id !== 'conv-2') // the unrelated conversation stays home
    .map((unit) => unit.id);

  const report = exportBugReport([broken, unrelated], {
    include: consented,
    title: 'Agent answered with a stale price',
    stepsToReproduce: '1. ask for the price of A-1\n2. update the price\n3. ask again',
    expected: 'the updated price',
    actual: 'the price from before the update',
    appVersion: '4.2.0',
  });

  console.log(`Bundle: ${report.filename} (${(report.zip.length / 1024).toFixed(1)} KB)`);
  console.log(`  files: ${report.files.map((file) => file.name).join(', ')}`);
  console.log(
    `  excluded on purpose: ${report.manifest.excluded.conversations} conversation(s), ` +
      `${report.manifest.excluded.turns} turn(s)\n`,
  );

  check(report.manifest.selected.includes('conv-1'), 'the broken conversation is in');
  check(!report.manifest.selected.includes('conv-2'), 'the unrelated one is out');
  check(report.manifest.excluded.conversations === 1, 'the exclusion is COUNTED, not silent');
  check(
    !report.files.some((file) => file.name.includes('conv-2')),
    'a deselected unit is out of every file',
  );
  check(
    !report.files.find((file) => file.name === 'conversation.json')!.text.includes('conv-2'),
    'and out of the derived transcript too',
  );

  // The zip is a real zip: write it, read its directory back.
  const dir = mkdtempSync(join(tmpdir(), 'af-bug-'));
  try {
    const path = join(dir, report.filename);
    writeFileSync(path, report.zip);
    const names = namesInZip(new Uint8Array(readFileSync(path)));
    check(names[0] === 'manifest.json', 'the manifest leads the archive');
    check(
      names.join(',') === report.manifest.files.map((file) => file.name).join(','),
      'the zip holds exactly what the manifest lists',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── STEP 3: file it. ─────────────────────────────────────────────────
  // In production this is two lines and a token in the environment:
  //
  //   const reporter = githubBugReporter({
  //     issueRepo: 'acme/checkout-agent',       // the conversation
  //     evidenceRepo: 'acme/agent-evidence',    // the run (private)
  //   });                                       // token: GITHUB_TOKEN
  //   const { issueUrl, zipUrl } = await reporter.file(report);
  //
  // Here GitHub is scripted through the `_fetch` seam so the example runs with
  // no token and no network.
  const requests: string[] = [];
  const scriptedGithub = (async (url: unknown, init?: unknown) => {
    const target = String(url);
    requests.push(`${((init ?? {}) as { method?: string }).method ?? 'GET'} ${target}`);
    if (/\/repos\/[^/]+\/[^/]+$/.test(target)) {
      return new Response(JSON.stringify({ private: true }), { status: 200 });
    }
    if (target.includes('/contents/')) {
      const path = decodeURIComponent(target.split('/contents/')[1] ?? '');
      return new Response(
        JSON.stringify({ content: { path, html_url: `https://github.test/blob/main/${path}` } }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ html_url: 'https://github.test/issues/7' }), {
      status: 201,
    });
  }) as unknown as typeof fetch;

  const reporter = githubBugReporter({
    issueRepo: 'acme/checkout-agent',
    evidenceRepo: 'acme/agent-evidence', // private: the run does not go public
    token: 'not-a-real-token',
    labels: ['bug', 'has-recording'],
    _fetch: scriptedGithub,
  });
  const filed = await reporter.file(report);

  console.log(`Filed: ${filed.issueUrl}`);
  console.log(`Evidence: ${filed.zipUrl}`);
  console.log(
    `Visibility check ran: ${filed.checkedVisibility} (private: ${String(filed.evidenceRepoPrivate)})\n`,
  );

  check(filed.checkedVisibility, 'the evidence repo visibility was verified before uploading');
  check(filed.evidenceRepoPrivate === true, 'the evidence repo is private');
  check(requests.length === 3, 'three HTTP calls: metadata, contents, issue');
  check(
    requests[2]!.includes('/repos/acme/checkout-agent/issues'),
    'the ISSUE went to the issue repo',
  );
  check(
    requests[1]!.includes('/repos/acme/agent-evidence/contents/'),
    'the EVIDENCE went to the evidence repo',
  );

  if (failures.length > 0) {
    console.error('\nFAILED:');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return { ok: false, failures };
  }
  console.log('All checks passed.');
  return {
    ok: true,
    filename: report.filename,
    issueUrl: filed.issueUrl,
    zipUrl: filed.zipUrl,
    excludedConversations: report.manifest.excluded.conversations,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput ?? 'what is the price of A-1?');
}
