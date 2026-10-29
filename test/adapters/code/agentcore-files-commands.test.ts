/**
 * `agentCoreCodeRunner` — files in and out of the sandbox, exactly and bounded,
 * and results that say only what AgentCore reported.
 *
 * Every test here drives the REAL SDK shim (`send(new Command(input))` and the
 * stream drain) through the pinned fake SDK of `../aws/awsCommandPin.ts`, so
 * what is asserted is what would leave this process. Nothing reaches AWS.
 *
 * The laws pinned:
 *   • REQUEST SHAPES — `writeFiles { content: [{ path, text } | { path, blob }] }`,
 *     `readFiles { paths: [path] }`, `executeCommand { command }`: the shapes
 *     read off `@aws-sdk/client-bedrock-agentcore` 3.1159.0.
 *   • BYTES ARE A BLOB — never base64 inside text, never a decode step.
 *   • ONE CALL, BOUNDED — a staging request over AgentCore's 100 MB per-call
 *     limit is refused before it is sent.
 *   • A FILE IS PAIRED BY ITS URI — missing or different fails closed; text or
 *     bytes is whichever field the service filled; over `maxBytes` is refused.
 *   • UNKNOWN STAYS UNKNOWN — no exit status unless reported; `ok` absent when
 *     neither an exit status nor an error verdict came back.
 *   • COMMANDS ARE OPT-IN — absent unless the runner was built with them.
 *   • A GONE SESSION IS ONE ERROR — `SessionExpiredError`, on every verb.
 *   • NOTHING SENT IS REPEATED — no command text and no file body in an error.
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { agentCoreCodeRunner } from '../../../src/adapters/code/agentcore.js';
import {
  AGENTCORE_MAX_REQUEST_BYTES,
  MANIFEST_SET_MARKER,
  manifestSetupCode,
  withManifestExport,
} from '../../../src/adapters/code/agentcoreWire.js';
import {
  canReadCodeFiles,
  canRunCodeCommands,
  canStageCodeInputs,
  CodeSandboxError,
  SessionExpiredError,
  STAGED_INPUTS_ENV,
  type CodeSession,
} from '../../../src/index.js';
import { AWS_COMMAND_PINS, fakeSdk, type FakeSdk } from '../aws/awsCommandPin.js';

// ─── Harness ─────────────────────────────────────────────────────────────

const IDENTIFIER = 'aws.codeinterpreter.v1';
const SESSION = 'ci-1';

/** One event on `InvokeCodeInterpreterResponse.stream`. */
type StreamEvent = Record<string, unknown>;

/** How the fake service answers one InvokeCodeInterpreter input. */
type Respond = (input: Record<string, unknown>) => StreamEvent[] | Error | Promise<never>;

function service(respond: Respond): FakeSdk {
  const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'agentCoreCodeRunner');
  if (!row) throw new Error('agentCoreCodeRunner is not pinned');
  return fakeSdk(row, {
    StartCodeInterpreterSessionCommand: { sessionId: SESSION },
    InvokeCodeInterpreterCommand: (input: Record<string, unknown>) => {
      const answer = respond(input);
      if (answer instanceof Promise) return answer;
      if (answer instanceof Error) throw answer;
      return {
        sessionId: SESSION,
        stream: (async function* () {
          for (const event of answer) yield event;
        })(),
      };
    },
    StopCodeInterpreterSessionCommand: { sessionId: SESSION },
  });
}

async function open(
  respond: Respond,
  extra: { commands?: boolean; maxOutputChars?: number; language?: string } = {},
): Promise<{ session: CodeSession; sdk: FakeSdk; invokes: () => Record<string, unknown>[] }> {
  const sdk = service(respond);
  const runner = agentCoreCodeRunner({ identifier: IDENTIFIER, _sdk: sdk.module, ...extra });
  const session = await runner.start({ key: 't=acme/p=ada/r=run-1' });
  const invokes = (): Record<string, unknown>[] =>
    sdk.sent.filter((s) => s.command === 'InvokeCodeInterpreterCommand').map((s) => s.input);
  return { session, sdk, invokes };
}

const result = (r: Record<string, unknown>): StreamEvent[] => [{ result: r }];
const ok = (stdout = ''): StreamEvent[] =>
  result({ content: [], structuredContent: { stdout, stderr: '', exitCode: 0 }, isError: false });
const written = (): StreamEvent[] =>
  result({ content: [{ type: 'text', text: 'Successfully wrote all files' }], isError: false });
const fileBack = (resource: Record<string, unknown>): StreamEvent[] =>
  result({ content: [{ type: 'resource', resource }], isError: false });
const setupConfirmed = (): StreamEvent[] => ok(`${MANIFEST_SET_MARKER}\n`);

/** A thrown SDK-style service error: an `Error` whose `name` is the exception class. */
function thrown(name: string, message: string): Error {
  return Object.assign(new Error(message), { name, $fault: 'client' });
}

const toolOf = (input: Record<string, unknown>): unknown => input['name'];

// ─── 1. Request shapes, as they leave the process ────────────────────────

describe('agentCoreCodeRunner — the request shapes AgentCore takes', () => {
  it('stageInputs sends ONE writeFiles: text as `text`, bytes as `blob`', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255]);
    const { session, invokes } = await open(() => written());
    const landed = await session.stageInputs?.([
      { name: 'rows', fileName: 'rows.csv', data: 'region,total\neu,3\n' },
      { name: 'chart', fileName: 'chart.png', data: png },
    ]);

    expect(invokes()).toEqual([
      {
        codeInterpreterIdentifier: IDENTIFIER,
        sessionId: SESSION,
        name: 'writeFiles',
        arguments: {
          content: [
            { path: 'af-staged-inputs/rows.csv', text: 'region,total\neu,3\n' },
            { path: 'af-staged-inputs/chart.png', blob: png },
          ],
        },
      },
    ]);
    expect(landed).toEqual([
      { name: 'rows', path: 'af-staged-inputs/rows.csv', bytes: 18 },
      { name: 'chart', path: 'af-staged-inputs/chart.png', bytes: 10 },
    ]);
  });

  it('BINARY IS A BLOB — the bytes themselves, never base64 inside text', async () => {
    const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256));
    const { session, invokes } = await open(() => written());
    await session.stageInputs?.([{ name: 'blob', data: bytes }]);

    const [entry] = (invokes()[0]?.['arguments'] as { content: Record<string, unknown>[] }).content;
    expect(Object.keys(entry ?? {}).sort()).toEqual(['blob', 'path']);
    // The SAME bytes — not a copy re-encoded, and not a string at all.
    expect(entry?.['blob']).toBe(bytes);
    const base64 = Buffer.from(bytes).toString('base64');
    expect(
      JSON.stringify(invokes(), (_k, v: unknown) => (v instanceof Uint8Array ? '<bytes>' : v)),
    ).not.toContain(base64);
  });

  it('readFile sends ONE readFiles naming exactly one canonical path', async () => {
    const { session, invokes } = await open(() =>
      fileBack({ type: 'text', uri: 'file:///out/report.csv', text: 'a,b\n' }),
    );
    await session.readFile?.('./out//report.csv', { maxBytes: 100 });
    expect(invokes()).toEqual([
      {
        codeInterpreterIdentifier: IDENTIFIER,
        sessionId: SESSION,
        name: 'readFiles',
        arguments: { paths: ['out/report.csv'] },
      },
    ]);
  });

  it('runCommand sends ONE executeCommand carrying the command and nothing else', async () => {
    const { session, invokes } = await open(() => ok('total 0\n'), { commands: true });
    await session.runCommand?.('ls -la');
    expect(invokes()).toEqual([
      {
        codeInterpreterIdentifier: IDENTIFIER,
        sessionId: SESSION,
        name: 'executeCommand',
        arguments: { command: 'ls -la' },
      },
    ]);
  });

  it('every verb is feature-detectable, and commands are ABSENT unless asked for', async () => {
    const plain = (await open(() => ok())).session;
    expect(canStageCodeInputs(plain)).toBe(true);
    expect(canReadCodeFiles(plain)).toBe(true);
    expect(canRunCodeCommands(plain)).toBe(false);
    expect('runCommand' in plain).toBe(false);
    const withCommands = (await open(() => ok(), { commands: true })).session;
    expect(canRunCodeCommands(withCommands)).toBe(true);
  });
});

// ─── 2. The per-call limit ───────────────────────────────────────────────

describe('agentCoreCodeRunner.stageInputs — AgentCore’s 100 MB per-call limit', () => {
  // One allocation, viewed at two lengths: base64 turns 3 bytes into 4, so a
  // blob of 75,000,000 bytes is a body just over the limit and one 1,000
  // bytes shorter is just under it.
  const big = new Uint8Array(75_000_000);

  it('a request over the limit is REFUSED before anything is sent, with its size', async () => {
    const { session, invokes } = await open(() => written());
    const err = await session.stageInputs?.([{ name: 'big', data: big }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodeSandboxError);
    expect((err as CodeSandboxError).reason).toBe('request-too-large');
    expect((err as CodeSandboxError).limit).toBe(AGENTCORE_MAX_REQUEST_BYTES);
    expect((err as CodeSandboxError).bytes).toBeGreaterThan(AGENTCORE_MAX_REQUEST_BYTES);
    expect(invokes()).toEqual([]);
  });

  it('a request just under the limit is sent', async () => {
    const { session, invokes } = await open(() => written());
    await session.stageInputs?.([{ name: 'big', data: big.subarray(0, big.length - 1_000) }]);
    expect(invokes().map(toolOf)).toEqual(['writeFiles']);
  });

  it('a write the service flags as an error is refused — nothing is reported as staged', async () => {
    const { session, invokes } = await open((input) =>
      toolOf(input) === 'writeFiles'
        ? result({ content: [{ type: 'text', text: 'disk full' }], isError: true })
        : ok(),
    );
    await expect(session.stageInputs?.([{ name: 'rows', data: 'x' }])).rejects.toMatchObject({
      reason: 'write-failed',
    });
    // Nothing staged ⇒ no manifest setup ahead of the next execution.
    await session.execute({ code: 'print(1)' });
    expect(invokes().map(toolOf)).toEqual(['writeFiles', 'executeCode']);
  });

  it('a write answered with NO result is not reported as done', async () => {
    const { session } = await open(() => []);
    await expect(session.stageInputs?.([{ name: 'rows', data: 'x' }])).rejects.toThrow(/no result/);
  });
});

// ─── 3. AF_STAGED_INPUTS, filled as localCodeRunner fills it ─────────────

describe('agentCoreCodeRunner — AF_STAGED_INPUTS reaches the code and the commands', () => {
  it('stages, then sets the manifest in the runtime ONCE, then runs the code unchanged', async () => {
    const { session, invokes } = await open(
      (input) => {
        if (toolOf(input) === 'writeFiles') return written();
        const code = (input['arguments'] as { code: string }).code;
        return code.includes(STAGED_INPUTS_ENV) ? setupConfirmed() : ok('42\n');
      },
      { language: 'python' },
    );
    await session.stageInputs?.([{ name: 'dataset', fileName: 'dataset.json', data: '[1]' }]);
    const first = await session.execute({ code: 'print(42)' });
    const second = await session.execute({ code: 'print(42)' });

    const sent = invokes();
    expect(sent.map(toolOf)).toEqual(['writeFiles', 'executeCode', 'executeCode', 'executeCode']);
    const setup = (sent[1]?.['arguments'] as { code: string; language: string }) ?? {};
    expect(setup.code).toBe(
      manifestSetupCode('python', JSON.stringify({ dataset: 'af-staged-inputs/dataset.json' })),
    );
    expect(setup.language).toBe('python');
    // The caller's code goes out byte for byte — no prelude, no shifted lines.
    expect(sent[2]?.['arguments']).toEqual({ code: 'print(42)', language: 'python' });
    expect(sent[3]?.['arguments']).toEqual({ code: 'print(42)', language: 'python' });
    expect(first.stdout).toBe('42\n');
    expect(second.stdout).toBe('42\n');
  });

  it('a NEW input changes the manifest, so it is set again before the next run', async () => {
    const { session, invokes } = await open((input) => {
      if (toolOf(input) === 'writeFiles') return written();
      const code = (input['arguments'] as { code: string }).code;
      return code.includes(STAGED_INPUTS_ENV) ? setupConfirmed() : ok();
    });
    await session.stageInputs?.([{ name: 'a', data: '1' }]);
    await session.execute({ code: 'x' });
    await session.stageInputs?.([{ name: 'b', data: '2' }]);
    await session.execute({ code: 'x' });
    const codes = invokes()
      .filter((i) => toolOf(i) === 'executeCode')
      .map((i) => (i['arguments'] as { code: string }).code);
    expect(codes.filter((c) => c.includes(STAGED_INPUTS_ENV))).toHaveLength(2);
    expect(codes[2]).toBe(
      manifestSetupCode(
        'python',
        JSON.stringify({ a: 'af-staged-inputs/a', b: 'af-staged-inputs/b' }),
      ),
    );
  });

  it('an UNCONFIRMED setup refuses the run — the code never goes out', async () => {
    const { session, invokes } = await open((input) =>
      toolOf(input) === 'writeFiles' ? written() : ok('PermissionDenied: env\n'),
    );
    await session.stageInputs?.([{ name: 'a', data: '1' }]);
    await expect(session.execute({ code: 'print("the real code")' })).rejects.toMatchObject({
      reason: 'staged-inputs-unset',
    });
    const codes = invokes().map((i) => JSON.stringify(i['arguments']));
    expect(codes.some((c) => c.includes('the real code'))).toBe(false);
  });

  it('a session that never stages sends exactly one executeCode — no setup at all', async () => {
    const { session, invokes } = await open(() => ok('1\n'));
    await session.execute({ code: 'print(1)', language: 'python' });
    expect(invokes()).toEqual([
      {
        codeInterpreterIdentifier: IDENTIFIER,
        sessionId: SESSION,
        name: 'executeCode',
        arguments: { code: 'print(1)', language: 'python' },
      },
    ]);
  });

  it('a command after staging carries the manifest as an exported variable', async () => {
    const { session, invokes } = await open(
      (input) => (toolOf(input) === 'writeFiles' ? written() : ok()),
      { commands: true },
    );
    await session.stageInputs?.([{ name: "it's", data: '1' }]);
    await session.runCommand?.('cat "$AF_STAGED_INPUTS"');
    const command = (invokes()[1]?.['arguments'] as { command: string }).command;
    expect(command).toBe(
      withManifestExport(
        'cat "$AF_STAGED_INPUTS"',
        JSON.stringify({ "it's": 'af-staged-inputs/_enc_it_u0027s' }),
      ),
    );
  });

  it.skipIf(!hasProgram('python3'))(
    'the Python setup really sets the variable and prints the marker',
    () => {
      const manifest = JSON.stringify({
        'a\'b"\\c': 'af-staged-inputs/x.json',
        [`ü${String.fromCodePoint(0x2028)}`]: 'p',
      });
      const code = `${manifestSetupCode(
        'python',
        manifest,
      )}\nimport os\nprint(os.environ["${STAGED_INPUTS_ENV}"])`;
      const out = execFileSync('python3', ['-c', code], { encoding: 'utf8' });
      expect(out.split('\n')).toEqual([MANIFEST_SET_MARKER, manifest, '']);
    },
  );

  it.skipIf(!hasProgram('node'))(
    'the JavaScript setup really sets the variable and prints the marker',
    () => {
      const manifest = JSON.stringify({ 'a\'b"\\c': 'af-staged-inputs/x.json' });
      const code = `${manifestSetupCode(
        'javascript',
        manifest,
      )}\nconsole.log(process.env.${STAGED_INPUTS_ENV});`;
      const out = execFileSync('node', ['-e', code], { encoding: 'utf8' });
      expect(out.split('\n')).toEqual([MANIFEST_SET_MARKER, manifest, '']);
    },
  );

  it.skipIf(!hasProgram('sh'))('the command export survives every quote a name can hold', () => {
    const manifest = JSON.stringify({ 'it\'s "x" $HOME `id` \\': 'af-staged-inputs/p' });
    const out = execFileSync(
      'sh',
      ['-c', withManifestExport('printf %s "$AF_STAGED_INPUTS"', manifest)],
      {
        encoding: 'utf8',
      },
    );
    expect(out).toBe(manifest);
  });
});

// ─── 4. readFile — paired by URI, exact, bounded ─────────────────────────

describe('agentCoreCodeRunner.readFile — one file, paired by the URI the service returned', () => {
  const read = async (
    resources: Record<string, unknown>[],
    path = 'out/report.csv',
    maxBytes = 1_000,
    extra: Record<string, unknown> = {},
  ) => {
    const { session } = await open(() =>
      result({
        content: resources.map((resource) => ({ type: 'resource', resource })),
        isError: false,
        ...extra,
      }),
    );
    return session.readFile?.(path, { maxBytes });
  };
  const refusal = (p: Promise<unknown> | undefined) =>
    p?.catch((e: unknown) => e as CodeSandboxError);

  it('TEXT comes back as a string, with the service’s own media type', async () => {
    const file = await read([
      { type: 'text', uri: 'file:///out/report.csv', mimeType: 'text/csv', text: 'a,b\n1,2\n' },
    ]);
    expect(file).toEqual({
      path: 'out/report.csv',
      data: 'a,b\n1,2\n',
      bytes: 8,
      mediaType: 'text/csv',
    });
  });

  it('BYTES come back as bytes', async () => {
    const blob = new Uint8Array([1, 2, 3]);
    const file = await read([{ type: 'blob', uri: 'file:///out/report.csv', blob }]);
    expect(file?.data).toBeInstanceOf(Uint8Array);
    expect(file?.bytes).toBe(3);
    expect(file?.mediaType).toBeUndefined();
  });

  it('text or bytes is the FIELD the service filled — never the file’s extension', async () => {
    const asText = await read(
      [{ uri: 'file:///chart.png', text: 'not really a png' }],
      'chart.png',
    );
    expect(typeof asText?.data).toBe('string');
    const asBytes = await read(
      [{ uri: 'file:///notes.txt', blob: new Uint8Array([104, 105]) }],
      'notes.txt',
    );
    expect(asBytes?.data).toBeInstanceOf(Uint8Array);
  });

  it('a percent-encoded URI pairs with the path it encodes', async () => {
    const file = await read(
      [{ uri: 'file:///out/my%20report.csv', text: 'x' }],
      'out/my report.csv',
    );
    expect(file?.data).toBe('x');
  });

  it('FAILS CLOSED on a file with NO uri', async () => {
    const err = await refusal(read([{ type: 'text', text: 'a,b' }]));
    expect(err).toBeInstanceOf(CodeSandboxError);
    expect(err?.reason).toBe('uri-missing');
  });

  it('FAILS CLOSED on a uri naming ANOTHER path — never paired by position', async () => {
    const err = await refusal(read([{ uri: 'file:///out/other.csv', text: 'someone else' }]));
    expect(err?.reason).toBe('uri-mismatch');
    expect(err?.path).toBe('out/report.csv');
  });

  it('FAILS CLOSED when one file of two names another path, even if the other matches', async () => {
    const err = await refusal(
      read([
        { uri: 'file:///out/report.csv', text: 'mine' },
        { uri: 'file:///out/other.csv', text: 'not mine' },
      ]),
    );
    expect(err?.reason).toBe('uri-mismatch');
  });

  it('refuses two files for one path, and a file with both text and bytes, or neither', async () => {
    const twice = await refusal(
      read([
        { uri: 'file:///out/report.csv', text: 'a' },
        { uri: 'file:///out/report.csv', text: 'b' },
      ]),
    );
    expect(twice?.reason).toBe('content-ambiguous');
    const both = await refusal(
      read([{ uri: 'file:///out/report.csv', text: 'a', blob: new Uint8Array([1]) }]),
    );
    expect(both?.reason).toBe('content-ambiguous');
    const neither = await refusal(read([{ uri: 'file:///out/report.csv', mimeType: 'text/csv' }]));
    expect(neither?.reason).toBe('content-ambiguous');
  });

  it('an answer flagged as an error, or with no file, returns nothing', async () => {
    const flagged = await refusal(read([], 'out/report.csv', 1_000, { isError: true }));
    expect(flagged?.reason).toBe('file-not-returned');
    const empty = await refusal(read([]));
    expect(empty?.reason).toBe('file-not-returned');
  });

  it('a read answered with NO result at all is a broken call, not an empty file', async () => {
    const { session } = await open(() => []);
    await expect(session.readFile?.('a.csv', { maxBytes: 10 })).rejects.toThrow(/no result/);
  });

  it('MAXBYTES — a file over it is refused whole, with its size; at it, returned whole', async () => {
    // 'é' is two bytes: the bound counts bytes, not characters.
    const text = 'é'.repeat(6); // 12 bytes, 6 characters
    const over = await refusal(
      read([{ uri: 'file:///out/report.csv', text }], 'out/report.csv', 11),
    );
    expect(over).toBeInstanceOf(CodeSandboxError);
    expect(over).toMatchObject({ reason: 'file-too-large', bytes: 12, limit: 11 });
    const at = await read([{ uri: 'file:///out/report.csv', text }], 'out/report.csv', 12);
    expect(at?.data).toBe(text);
  });

  it('a read must name its bound — no maxBytes is a TypeError, not an unbounded read', async () => {
    const { session, invokes } = await open(() => ok());
    for (const bad of [undefined, 0, -1, 1.5, Number.NaN, '10']) {
      await expect(
        session.readFile?.('a.csv', { maxBytes: bad as unknown as number }),
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(invokes()).toEqual([]);
  });

  it('a refused file’s CONTENTS never appear in the error', async () => {
    const secret = 'ssn=123-45-6789';
    const err = await refusal(read([{ uri: 'file:///out/other.csv', text: secret }]));
    expect(String(err?.message)).not.toContain(secret);
    const big = await refusal(
      read([{ uri: 'file:///out/report.csv', text: secret }], 'out/report.csv', 3),
    );
    expect(String(big?.message)).not.toContain(secret);
  });
});

// ─── 5. runCommand — bounded, and only what was reported ─────────────────

describe('agentCoreCodeRunner.runCommand — bounded output, reported exit status only', () => {
  const command = async (events: StreamEvent[], options = {}, runner = {}) => {
    const { session } = await open(() => events, { commands: true, ...runner });
    return session.runCommand?.('make report', options);
  };

  it('the exit status comes from the structured result', async () => {
    const out = await command(
      result({
        content: [],
        structuredContent: { stdout: '', stderr: 'boom', exitCode: 2 },
        isError: true,
      }),
    );
    expect(out).toEqual({ stdout: '', stderr: 'boom', exitCode: 2, isError: true });
  });

  it('MISSING EXIT CODE STAYS UNDEFINED — never inferred from isError', async () => {
    const flagged = await command(
      result({ content: [], structuredContent: { stdout: 'x', stderr: 'y' }, isError: true }),
    );
    expect(flagged?.exitCode).toBeUndefined();
    expect('exitCode' in (flagged ?? {})).toBe(false);
    expect(flagged?.isError).toBe(true);
    const clean = await command(
      result({ content: [], structuredContent: { stdout: 'x' }, isError: false }),
    );
    expect('exitCode' in (clean ?? {})).toBe(false);
    expect(clean?.isError).toBe(false);
    const silent = await command(result({ content: [{ type: 'text', text: 'only text' }] }));
    expect(silent).toEqual({ stdout: 'only text', stderr: '' });
  });

  it('stdout and stderr are BOUNDED, and the cut is stated', async () => {
    const out = await command(
      result({
        content: [],
        structuredContent: { stdout: 'o'.repeat(50), stderr: 'e'.repeat(30), exitCode: 0 },
      }),
      { maxOutputChars: 10 },
    );
    expect(out).toMatchObject({
      stdout: 'o'.repeat(10),
      stderr: 'e'.repeat(10),
      truncated: { stdout: true, stderr: true, ofChars: 50 },
    });
  });

  it('the runner’s own ceiling applies when a call names none', async () => {
    const out = await command(
      result({ content: [], structuredContent: { stdout: 'o'.repeat(50), exitCode: 0 } }),
      {},
      { maxOutputChars: 20 },
    );
    expect(out?.stdout).toHaveLength(20);
    expect(out?.truncated).toEqual({ stdout: true, ofChars: 50 });
  });

  it('a CHECKPOINT is read over the whole stdout — a marker past the cut is still seen', async () => {
    const stdout = `${'row\n'.repeat(1_000)}STEP_DONE\n`;
    const seen = await command(result({ content: [], structuredContent: { stdout } }), {
      maxOutputChars: 10,
      checkpoint: 'STEP_DONE',
    });
    expect(seen?.checkpointSeen).toBe(true);
    expect(seen?.stdout).not.toContain('STEP_DONE');
    // It proves its own line and nothing else: no exit status was reported.
    expect(seen?.exitCode).toBeUndefined();
  });

  it('a checkpoint must be its own line; asked and missing is false; not asked is absent', async () => {
    const inside = await command(ok('NOT_STEP_DONE_YET\n'), { checkpoint: 'STEP_DONE' });
    expect(inside?.checkpointSeen).toBe(false);
    const notAsked = await command(ok('STEP_DONE\n'));
    expect('checkpointSeen' in (notAsked ?? {})).toBe(false);
    const crlf = await command(ok('STEP_DONE\r\n'), { checkpoint: 'STEP_DONE' });
    expect(crlf?.checkpointSeen).toBe(true);
  });

  it('a service refusal names the exception, never the command it was sent', async () => {
    const secret = 'curl -H "Authorization: Bearer sk-live-123" https://example.com';
    const { session } = await open(
      () => [{ validationException: { message: `Invalid command: ${secret}` } }],
      { commands: true },
    );
    const err = (await session.runCommand?.(secret).catch((e: unknown) => e)) as Error;
    expect(err.name).toBe('ValidationException');
    expect(err.message).not.toContain('sk-live-123');
    expect(err.message).not.toContain(secret);
  });

  it('options are checked before anything is sent, and the message never repeats the command', async () => {
    const { session, invokes } = await open(() => ok(), { commands: true });
    for (const options of [
      { timeoutMs: 0 },
      { maxOutputChars: -1 },
      { checkpoint: 'a\nb' },
      { checkpoint: '' },
    ]) {
      const err = await session
        .runCommand?.('rm -rf /tmp/x', options)
        .catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).not.toContain('rm -rf');
    }
    await expect(session.runCommand?.('   ')).rejects.toBeInstanceOf(TypeError);
    expect(invokes()).toEqual([]);
  });

  it('TIMEOUT — the wait ends at timeoutMs, and the error says the command may still be running', async () => {
    const { session } = await open(() => new Promise<never>(() => undefined), { commands: true });
    const err = await session.runCommand?.('sleep 999', { timeoutMs: 25 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodeSandboxError);
    expect((err as CodeSandboxError).reason).toBe('timed-out');
    expect((err as Error).message).toMatch(/may still be running/);
    expect((err as Error).message).not.toContain('sleep 999');
  });

  it('ABORT — the caller’s own reason comes back, and the request carried the signal', async () => {
    let seen: AbortSignal | undefined;
    const runner = agentCoreCodeRunner({
      identifier: IDENTIFIER,
      commands: true,
      _client: {
        startSession: () => Promise.resolve({ sessionId: SESSION }),
        invoke: (_input, options) => {
          seen = options?.abortSignal;
          return new Promise(() => undefined);
        },
        stopSession: () => Promise.resolve(),
      },
    });
    const session = await runner.start({ key: 'k' });
    const controller = new AbortController();
    const pending = session.runCommand?.('sleep 999', { signal: controller.signal });
    const reason = new Error('the person cancelled');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(seen?.aborted).toBe(true);
  });
});

// ─── 6. execute — ok says only what was reported ─────────────────────────

describe('agentCoreCodeRunner.execute — ok is the service’s word, or absent', () => {
  const run = async (events: StreamEvent[]) =>
    (await open(() => events)).session.execute({ code: 'x' });

  it('NEITHER exitCode NOR isError reported ⇒ ok is ABSENT, not true (no success from silence)', async () => {
    const outcome = await run(result({ content: [], structuredContent: { stdout: 'partial' } }));
    expect('ok' in outcome).toBe(false);
    expect(outcome.ok).toBeUndefined();
    expect('exitCode' in outcome).toBe(false);
    expect(outcome.stdout).toBe('partial');
  });

  it('an empty stream says nothing either ⇒ ok absent', async () => {
    const outcome = await run([]);
    expect(outcome).toEqual({ stdout: '', stderr: '' });
  });

  it('a reported exit status decides it', async () => {
    expect((await run(result({ content: [], structuredContent: { exitCode: 0 } }))).ok).toBe(true);
    expect((await run(result({ content: [], structuredContent: { exitCode: 3 } }))).ok).toBe(false);
  });

  it('the service’s own verdict decides it when there is no exit status', async () => {
    expect((await run(result({ content: [], isError: true }))).ok).toBe(false);
    expect((await run(result({ content: [], isError: false }))).ok).toBe(true);
    // An error verdict outranks a clean exit status, as it always has.
    expect(
      (await run(result({ content: [], structuredContent: { exitCode: 0 }, isError: true }))).ok,
    ).toBe(false);
  });
});

// ─── 7. A gone session is ONE error ──────────────────────────────────────

describe('agentCoreCodeRunner — every form of a gone session is SessionExpiredError', () => {
  const forms: readonly [string, Respond][] = [
    [
      'a thrown ResourceNotFoundException',
      () => thrown('ResourceNotFoundException', 'Session not found'),
    ],
    [
      'a thrown ValidationException saying "not active"',
      () => thrown('ValidationException', `Session ${SESSION} is not active`),
    ],
    [
      'a resourceNotFoundException on the stream',
      () => [{ resourceNotFoundException: { message: 'gone' } }],
    ],
    [
      'a validationException on the stream saying "not active"',
      () => [{ validationException: { message: 'The session is not active.' } }],
    ],
    [
      'any stream error naming an inactive session',
      () => [{ conflictException: { message: `Session ${SESSION} is inactive` } }],
    ],
  ];

  const verbs: readonly [string, (s: CodeSession) => Promise<unknown> | undefined][] = [
    ['execute', (s) => s.execute({ code: 'x' })],
    ['stageInputs', (s) => s.stageInputs?.([{ name: 'a', data: 'b' }])],
    ['readFile', (s) => s.readFile?.('a.csv', { maxBytes: 10 })],
    ['runCommand', (s) => s.runCommand?.('ls')],
  ];

  for (const [form, respond] of forms) {
    for (const [verb, call] of verbs) {
      it(`${form} → SessionExpiredError (${verb})`, async () => {
        const { session } = await open(respond, { commands: true });
        const err = await call(session)?.catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SessionExpiredError);
        expect(err).toMatchObject({
          code: 'ERR_SESSION_EXPIRED',
          backend: 'agentCoreCodeRunner',
          sessionId: SESSION,
        });
        expect((err as SessionExpiredError).evidence).toMatch(/Exception$/);
      });
    }
  }

  it('a ValidationException that does NOT say "not active" is not an expiry', async () => {
    const { session } = await open(() =>
      thrown('ValidationException', 'language must be one of …'),
    );
    const err = await session.execute({ code: 'x' }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SessionExpiredError);
    expect((err as Error).name).toBe('ValidationException');
  });

  it('a ResourceNotFound at START is a wrong identifier, not an expired session', async () => {
    const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'agentCoreCodeRunner');
    const sdk = fakeSdk(row!, {
      StartCodeInterpreterSessionCommand: () => {
        throw thrown('ResourceNotFoundException', 'No code interpreter named nope');
      },
    });
    const runner = agentCoreCodeRunner({ identifier: 'nope', _sdk: sdk.module });
    const err = await runner.start({ key: 'k' }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SessionExpiredError);
    expect((err as Error).name).toBe('ResourceNotFoundException');
  });

  it('stop() still treats a gone session as done', async () => {
    const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'agentCoreCodeRunner');
    const sdk = fakeSdk(row!, {
      StartCodeInterpreterSessionCommand: { sessionId: SESSION },
      StopCodeInterpreterSessionCommand: () => {
        throw thrown('ResourceNotFoundException', 'gone');
      },
    });
    const session = await agentCoreCodeRunner({ identifier: IDENTIFIER, _sdk: sdk.module }).start({
      key: 'k',
    });
    await expect(session.stop()).resolves.toBeUndefined();
  });
});

// ─── 8. A stopped session refuses every verb ─────────────────────────────

describe('agentCoreCodeRunner — a stopped session', () => {
  it('refuses every verb by name, and sends nothing', async () => {
    const { session, invokes } = await open(() => ok(), { commands: true });
    await session.stop();
    await expect(session.execute({ code: 'x' })).rejects.toThrow(/was stopped/);
    await expect(session.stageInputs?.([{ name: 'a', data: 'b' }])).rejects.toThrow(/stage inputs/);
    await expect(session.readFile?.('a', { maxBytes: 1 })).rejects.toThrow(/read files/);
    await expect(session.runCommand?.('ls')).rejects.toThrow(/run commands/);
    expect(invokes()).toEqual([]);
  });
});

function hasProgram(name: string): boolean {
  try {
    execFileSync(name, name === 'sh' ? ['-c', 'exit 0'] : ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
