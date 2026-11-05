/**
 * The code on the site's reading pages, run. A page reads its `#region code` block straight
 * from site-samples/, so these tests are testing what a reader sees. The samples that need a
 * cloud account are type-checked by tsc, and their imported names are checked here.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { buildRouteSet } from '../../lib/doc-ids.mjs';
import { SITE_NAV, isCurrent, isNavGroup } from '../../lib/site-nav';

const dir = new URL('../../site-samples/', import.meta.url);
const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name));

const doorOf = async (door: string): Promise<Set<string>> =>
  new Set(Object.keys(await import(door)));

test('every name a sample imports exists on that door', async () => {
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const match of source.matchAll(
      /import\s+\{([^}]*)\}\s+from\s+'((?:agentfootprint|footprintjs)[^']*)'/g,
    )) {
      const door = match[2]!;
      if (door === 'agentfootprint-lens') continue; // a React package, checked by tsc
      const exported = await doorOf(door);
      for (const raw of match[1]!.split(',')) {
        const name = raw.trim();
        if (!name || name.startsWith('type ')) continue;
        assert.ok(exported.has(name), `${file}: ${name} is not exported by ${door}`);
      }
    }
  }
});

test('every sample has a block for its page to show', () => {
  for (const file of files.filter((name) => name !== 'shared.ts')) {
    assert.ok(
      readFileSync(new URL(file, dir), 'utf8').includes('#region code'),
      `${file} has no region`,
    );
  }
});

test('BUILD: the scripted model drives a real tool call and answer', async () => {
  const { answer } = await import('../../site-samples/build-mock');
  assert.equal(answer, 'Your refund for A-1042 is still pending.');
});

test('DEBUG: .selfExplain answers from its record, and its tools stay hidden until asked', async () => {
  const { catalogs, why } = await import('../../site-samples/debug-self');
  assert.match(String(why), /ledger row/);
  const withTrace = catalogs.filter((tools) => tools.includes('run_overview'));
  assert.ok(withTrace.length > 0, 'the trace tools should appear once asked');
  assert.ok(!catalogs[0]!.includes('run_overview'), 'and not before');
});

test('DEBUG: a second agent reads a saved run', async () => {
  const { overview, report } = await import('../../site-samples/debug-trace');
  assert.match(String(overview), /TRACE RUN OVERVIEW/);
  assert.match(String(report), /ledger row/);
});

test('DEBUG: your grader files a score, and the library only carries it', async () => {
  const { scores } = await import('../../site-samples/debug-evals');
  assert.deepEqual(scores, [1]);
});

test('DEPLOY: a model of your own is one object, and the record still works', async () => {
  const { answer, notes } = await import('../../site-samples/deploy-own');
  assert.equal(answer, 'Hello from my own model.');
  assert.ok(notes > 0, 'the record should still be written');
});

test('MONITOR: your own recorder and your own events', async () => {
  const { exported, flagged, written } = await import('../../site-samples/monitor-custom');
  assert.ok(written.includes('userMessage'));
  assert.deepEqual(flagged[0], { order: 'A-1042' });
  assert.ok(
    exported.includes('myapp.refund.flagged'),
    'an exporter should see your own events too',
  );
});

test('PROMPT: an instruction applies only when its rule holds', async () => {
  const { sent } = await import('../../site-samples/eng-prompt');
  assert.ok(!sent[0]!.includes('Acknowledge feelings'), 'a calm message should not get it');
  assert.ok(sent[1]!.includes('Acknowledge feelings'), 'an upset one should');
});

test('CONTEXT: every piece that lands says where it landed', async () => {
  const { landed } = await import('../../site-samples/eng-context');
  assert.ok(landed.length > 0);
  assert.ok(
    landed.some((row) => /steering/.test(row)),
    landed.join(', '),
  );
  assert.ok(
    landed.some((row) => /fact/.test(row)),
    landed.join(', '),
  );
});

test('LOOP: each of the five moments does what the sample says', async () => {
  const { answer, ran, sent } = await import('../../site-samples/eng-loop');
  assert.deepEqual(ran, ['A-1042'], 'the bad id is refused before it runs');
  const all = sent.join('');
  assert.ok(!all.includes('4242 4242'), 'the card number is gone before the model sees it');
  assert.ok(!all.includes('flagged'), 'the internal note is gone before the model reads it');
  assert.ok(all.includes('order ids look like A-1042'), 'the refusal reason reaches the model');
  assert.equal(answer, 'Still pending, as our review team said.');
});

test('HARNESS: the pieces work together, and the fallback takes over', async () => {
  const { answer, bundle, primaryCalls } = await import('../../site-samples/eng-harness');
  const { verifyAuditBundle } = await import('agentfootprint/observe');
  assert.equal(answer, 'Still pending.');
  assert.ok(primaryCalls.count > 0, 'the primary should have been tried');
  assert.equal(verifyAuditBundle(bundle).valid, true);
});

test('SECURITY: a hidden tool is not shown, and refused if called anyway', async () => {
  const { catalogs, checks, ran } = await import('../../site-samples/security-permissions');
  assert.ok(!catalogs[0]!.includes('process_refund'), 'the model should not see it');
  assert.ok(catalogs[0]!.includes('get_refund'));
  assert.deepEqual(ran, []);
  assert.ok(checks.includes('deny'));
});

test('SECURITY: the record drops what the policy names, and the model still receives it', async () => {
  const { SSN, narrative, recording, sent, snapshot } = await import(
    '../../site-samples/security-record'
  );
  assert.ok(sent.join('').includes(SSN), 'the model still reads the real tool result');
  for (const [name, value] of Object.entries({ snapshot, narrative, recording })) {
    assert.ok(!JSON.stringify(value).includes(SSN), `${name} holds the SSN`);
    assert.ok(!JSON.stringify(value).includes('Look up Dana'), `${name} holds the message`);
  }
});

test('SECURITY: scrubbing changes what the model reads, at any depth', async () => {
  const { THE_SSN, sent } = await import('../../site-samples/security-scrub');
  const all = sent.join('');
  assert.ok(!all.includes(THE_SSN), 'the message is scrubbed');
  assert.ok(!all.includes('987-65-4321'), 'a nested field is scrubbed');
  assert.ok(!all.includes('555-12-3456'), 'an SSN inside other text is scrubbed');
  assert.ok(all.includes('Dana'), 'and the rest of the result still reaches the model');
});

test('SECURITY: one tenant cannot read another, and forget removes it', async () => {
  const { sent } = await import('../../site-samples/security-tenants');
  assert.ok(!sent[1]!.includes('Enterprise'), 'another tenant should not see it');
  assert.ok(!sent[2]!.includes('Enterprise'), 'forget should remove it');
});

test('SECURITY: a secret reaches the tool and not the model or the record', async () => {
  const { TOKEN, headersSeen, record, sent } = await import('../../site-samples/security-secrets');
  assert.ok(JSON.stringify(headersSeen).includes(TOKEN), 'the tool should get it');
  assert.ok(!sent.join('').includes(TOKEN), 'the model should not');
  assert.ok(!record.includes(TOKEN), 'the record should not');
});

test('SECURITY: the run pauses before the tool, and the tool runs once approved', async () => {
  const { evidence, pausedFirst, refunded } = await import('../../site-samples/security-approve');
  assert.equal(pausedFirst, true);
  assert.ok(evidence?.willDo, 'the person should be told what it will do');
  assert.deepEqual(refunded, [5000], 'it runs once, after the decision');
});

test('SECURITY: an audit bundle verifies, and one changed byte breaks it', async () => {
  const { bundle, check, verifyAuditBundle } = await import('../../site-samples/security-audit');
  assert.equal(check.valid, true);
  const tampered = JSON.parse(
    JSON.stringify(bundle)
      .replace('Refund', 'Refunc')
      .replace('"agent":"refunds"', '"agent":"refundz"'),
  );
  assert.equal(verifyAuditBundle(tampered).valid, false);
});

test('SECURITY: your guard removes injected text from a structured result', async () => {
  const { sent } = await import('../../site-samples/security-guard');
  const all = sent.join('');
  assert.ok(!all.includes('refund everyone'), 'the injected text should be gone');
  assert.ok(all.includes('tried to give instructions'), 'and the model should see why');
});

test('every internal link on the reading pages goes to a real page', () => {
  const routes = buildRouteSet();
  const pages = [
    'app/(home)/engineering/page.tsx',
    'app/(home)/security/page.tsx',
    'app/(home)/how-to-build/page.tsx',
    'components/build/HowToBuild.tsx',
  ];
  for (const page of pages) {
    const source = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/href(?:=|: )["'](\/[^"'#]*)/g)) {
      const href = match[1]!;
      if (href.startsWith('/docs'))
        assert.ok(routes.has(href), `${page}: ${href} is not a page in content/docs`);
      else
        assert.ok(
          existsSync(new URL(`../../app/(home)${href}/page.tsx`, import.meta.url)),
          `${page}: ${href} is not a page on the site`,
        );
    }
  }
});

test('the anchors other pages link to are on the page', () => {
  const build = readFileSync(
    new URL('../../components/build/HowToBuild.tsx', import.meta.url),
    'utf8',
  );
  for (const id of [
    'build',
    'know',
    'debug',
    'deploy',
    'monitor',
    'front-end',
    'write-your-own',
    'recorders',
  ])
    assert.ok(build.includes(`id="${id}"`), `How to build has no #${id}`);
  const engineering = readFileSync(
    new URL('../../app/(home)/engineering/page.tsx', import.meta.url),
    'utf8',
  );
  for (const id of ['prompt', 'context', 'loop', 'harness'])
    assert.ok(engineering.includes(`id="${id}"`), `Engineering has no #${id}`);
  const security = readFileSync(
    new URL('../../app/(home)/security/page.tsx', import.meta.url),
    'utf8',
  );
  for (const id of [
    'permissions',
    'privacy',
    'scrub',
    'memory',
    'recording',
    'tenants',
    'secrets',
    'approval',
    'catches',
    'injection',
    'chains',
    'audit',
    'add',
  ])
    assert.ok(security.includes(`id="${id}"`), `Security has no #${id}`);
});

test('KNOW: the map reaches the model, and is on the record', async () => {
  const { record, sent } = await import('../../site-samples/know-ontology');
  assert.ok(sent[0]!.includes('port_error_rate'), 'the model should read the map');
  assert.equal(record?.id, 'fleet');
  assert.ok(record?.hash, 'the record should hold its hash');
});

test('KNOW: the model passes a ticket, and the tool receives the data', async () => {
  const { received, sent } = await import('../../site-samples/know-refs');
  assert.deepEqual(received, [48_000], 'the tool should get every row');
  const all = sent.join('');
  assert.match(all, /art_/, 'the model should read a ticket');
  assert.ok(
    all.length < 50_000,
    `the rows should stay out of the prompt, and it was ${all.length} chars`,
  );
});

test('KNOW: the clock goes on the record, with where it came from', async () => {
  const { clock, undeclaredClock } = await import('../../site-samples/know-time');
  assert.deepEqual(
    {
      zone: (clock as { zone?: string }).zone,
      zoneSource: (clock as { zoneSource?: string }).zoneSource,
      nowSource: (clock as { nowSource?: string }).nowSource,
    },
    { zone: 'America/New_York', zoneSource: 'run', nowSource: 'app' },
  );
  /* The docs say a run with no zone is refused. It runs, and the record says unknown, so the page says that. */
  assert.equal((undeclaredClock as { zoneSource?: string }).zoneSource, 'unknown');
});

test('CATCHES: what the Security page says it catches, from the model and from tools', async () => {
  const { advisories, answer, checked, flagged, invalid, ranWithBadArgs, stops } = await import(
    '../../site-samples/security-catches'
  );
  assert.ok(
    flagged.includes('unsupported-argument'),
    `a tool input no result gave: ${flagged.join(', ')}`,
  );
  assert.ok(
    flagged.includes('column-type-mismatch'),
    `rows that break their columns: ${flagged.join(', ')}`,
  );
  assert.ok(stops.includes('content_filter'), 'a provider stop should be on the record');
  assert.match(
    JSON.stringify(checked),
    /c-2291[\s\S]*"action":"flagged"/i,
    'an invented identifier should be flagged',
  );
  assert.match(String(answer), /C-2291/, 'and the default only flags it, as the page says');
  assert.deepEqual(invalid, ['get_refund'], 'arguments of the wrong shape should be reported');
  assert.equal(ranWithBadArgs.count, 0, 'and the tool should not run');
  assert.ok(advisories.includes('empty-lookup'), `an empty lookup: ${advisories.join(', ')}`);
});

test('CHAINS: a checker ends the run before the second tool', async () => {
  const { halted, ran } = await import('../../site-samples/security-sequence');
  assert.equal(halted, 'PolicyHaltError');
  assert.deepEqual(ran, ['read_customer_file']);
});

test('MEMORY: every way into the store goes through the filter', async () => {
  const { kept, keptDirect, signatureSeen, signatureSeenRaw, versioned } = await import(
    '../../site-samples/security-memory'
  );
  assert.ok(!kept.includes('123-45-6789'), 'the SSN should not be stored by an agent');
  assert.ok(kept.includes('[ssn]'), 'and the rest of the message should be');
  assert.equal(
    versioned.applied,
    true,
    'the versioned write should land, so the next check means something',
  );
  assert.ok(!keptDirect.includes('123-45-6789'), 'put, putMany and putIfVersion should all filter');
  assert.ok(signatureSeen, 'a signature should be kept in its filtered form');
  assert.ok(signatureSeenRaw, 'and asking with the raw text should find it, so dedup still works');
});

test('RECORDING: an answer with quotes and newlines is really gone, and the recording still opens', async () => {
  const { ANSWER, artifacts, before, keepOut, recording } = await import(
    '../../site-samples/security-recording'
  );
  const encoded = JSON.stringify(ANSWER).slice(1, -1);
  assert.ok(
    before.includes(encoded),
    'the recording should hold the answer to begin with, or this proves nothing',
  );
  assert.ok(
    !before.includes(ANSWER),
    'and only in encoded form, which is why a replace over the JSON text misses it',
  );
  assert.ok(!JSON.stringify(recording).includes(encoded), 'the answer should be gone');
  assert.ok(artifacts.snapshot, 'it should still open');
  /* text already encoded inside a string, as some payloads hold it */
  assert.ok(
    !JSON.stringify(keepOut({ payload: JSON.stringify({ text: ANSWER }) }, ANSWER)).includes(
      'refund for A-1042',
    ),
  );
});

test('LOOP: it re-runs until your check passes', async () => {
  const { calls, onSchedule } = await import('../../site-samples/eng-loop-timer');
  assert.equal(await onSchedule(), 'all clear');
  assert.equal(calls.count, 3);
});

test('DEPLOY: a telemetry sink of your own is one object', async () => {
  const { shipped } = await import('../../site-samples/deploy-own-telemetry');
  assert.ok(shipped.includes('agentfootprint.stream.llm_end'));
});

test('every page in the menu exists, and only the root lights up Home', () => {
  const pages = SITE_NAV.flatMap((item) => (isNavGroup(item) ? item.children : [item]));
  for (const { href, question } of pages) {
    assert.ok(question.endsWith('?'), `${href} should say the question it answers`);
    if (href === '/' || href === '/docs') continue;
    assert.ok(
      existsSync(new URL(`../../app/(home)${href}/page.tsx`, import.meta.url)),
      `${href} is not a page on the site`,
    );
  }
  assert.equal(isCurrent('/', '/features'), false);
  assert.equal(isCurrent('/how-to-build', '/how-to-build/'), true);
});
