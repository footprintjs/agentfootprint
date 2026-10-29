/**
 * 117 — Files in and out of a code sandbox, and commands, exactly and bounded.
 *
 * A code runner holds data so the model does not have to. That only works if
 * the data moves in and out EXACTLY — bytes as bytes, a file whole or not at
 * all — and if what comes back says only what the sandbox reported.
 *
 *   1. IN       — `stageInputs`: text as text, bytes as bytes, one call.
 *   2. COMMAND  — `runCommand` (opt-in: `commands: true`): bounded output, the
 *                 cut stated, a checkpoint read before the cut, and an exit
 *                 status only when the backend reported one.
 *   3. OUT      — `readFile(path, { maxBytes })`: one file, whole, or refused.
 *   4. REFUSED  — a path that leaves the working directory, and a file over
 *                 its bound, refused by name.
 *   5. UNKNOWN  — AgentCore answering with no exit status: `exitCode` stays
 *                 absent and `ok` stays absent. Unknown is never success.
 *
 * Parts 1–4 use `localCodeRunner` for real, in a fresh temp directory (process
 * isolation on this machine — not a sandbox, and it says so). Part 5 uses
 * `agentCoreCodeRunner` with an in-memory stand-in for AgentCore, so nothing
 * here needs AWS; swap the stand-in for real credentials and the calls are the
 * same.
 *
 * Run:  npx tsx examples/features/117-code-files-and-commands.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canReadCodeFiles, canRunCodeCommands, CodeSandboxError } from '../../src/index.js';
import {
  agentCoreCodeRunner,
  localCodeRunner,
  type AgentCoreCodeClientLike,
} from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/117-code-files-and-commands',
  title: 'Files in and out of a code sandbox, and commands',
  group: 'features',
  description:
    'A code session moves files in and out exactly and bounded: stageInputs writes text as text and bytes as bytes, readFile returns one file whole (paired to its path, never cut — a file over maxBytes is refused), and runCommand (opt-in with commands: true) bounds its output, states the cut, reads a checkpoint before the cut and reports an exit status only when the backend did. Both adapters refuse the same paths. On AgentCore an outcome the service did not report stays unknown.',
  defaultInput: null,
  providerSlots: [],
  tags: ['feature', 'tools', 'code-interpreter', 'files', 'commands', 'sandbox'],
};

export async function run(): Promise<unknown> {
  const workdir = mkdtempSync(join(tmpdir(), 'af-example-117-'));
  try {
    // #region files-in-out
    // `commands: true` is the opt-in: without it the session has no
    // `runCommand` at all — it runs arbitrary shell.
    const runner = localCodeRunner({ cwd: workdir, commands: true, maxOutputChars: 200 });
    const session = await runner.start({ key: 'example-117' });

    // 1. IN — text as text, bytes as bytes. The manifest reaches the code AND
    //    the commands as AF_STAGED_INPUTS.
    const staged = await session.stageInputs?.([
      { name: 'rows', fileName: 'rows.csv', data: 'region,total\neu,3\nus,5\n' },
      { name: 'logo', fileName: 'logo.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    console.log('1. IN — staged:', staged?.map((s) => `${s.name} (${s.bytes} bytes)`).join(', '));

    // 2. COMMAND — the output is bounded and the cut stated; the checkpoint is
    //    read over the WHOLE stdout, so a marker past the cut is still seen.
    if (canRunCodeCommands(session)) {
      const step = await session.runCommand(
        'mkdir -p out && for i in $(seq 1 100); do echo "row $i"; done && ' +
          'printf "region,total\\neu,3\\n" > out/report.csv && echo REPORT_DONE',
        { timeoutMs: 10_000, maxOutputChars: 40, checkpoint: 'REPORT_DONE' },
      );
      console.log('2. COMMAND — exit status:', step.exitCode ?? '(not reported)');
      console.log('   cut:', step.truncated, '— checkpoint seen:', step.checkpointSeen);
    }

    // 3. OUT — one file, whole. A file on disk is bytes, so bytes come back.
    if (canReadCodeFiles(session)) {
      const report = await session.readFile('./out//report.csv', { maxBytes: 1_000 });
      console.log(
        `3. OUT — ${report.path}: ${report.bytes} bytes →`,
        JSON.stringify(Buffer.from(report.data as Uint8Array).toString('utf8')),
      );
    }
    // #endregion files-in-out

    // 4. REFUSED — by name, before anything is read.
    for (const [path, maxBytes] of [
      ['../outside.txt', 1_000],
      ['/etc/passwd', 1_000],
      ['out/report.csv', 5],
    ] as const) {
      const refused = await session.readFile?.(path, { maxBytes }).catch((e: unknown) => e);
      if (refused instanceof CodeSandboxError) {
        console.log(`4. REFUSED — ${path} (maxBytes ${maxBytes}): ${refused.reason}`);
      }
    }
    await session.stop();

    // #region unknown-stays-unknown
    // 5. UNKNOWN — the same port on AgentCore. This stand-in answers a command
    //    with output and NO exit status, and a code run with nothing at all.
    const sandbox = agentCoreCodeRunner({
      identifier: 'aws.codeinterpreter.v1',
      commands: true,
      _client: inMemoryAgentCore(),
    });
    const remote = await sandbox.start({ key: 'example-117' });
    await remote.stageInputs?.([{ name: 'rows', fileName: 'rows.csv', data: 'region,total\n' }]);
    const listed = await remote.runCommand?.('ls af-staged-inputs');
    console.log('5. UNKNOWN — command exit status:', listed?.exitCode ?? '(not reported)');
    const ran = await remote.execute({ code: 'print(1)' });
    console.log('   code run ok:', ran.ok ?? '(not reported — never read as success)');
    const back = await remote.readFile?.('af-staged-inputs/rows.csv', { maxBytes: 100 });
    console.log('   read back as', typeof back?.data === 'string' ? 'text' : 'bytes', '→', back?.data);
    // #endregion unknown-stays-unknown
    await remote.stop();
    return { staged: staged?.length ?? 0 };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

/**
 * An in-memory stand-in for AgentCore Code Interpreter: it keeps written
 * files, answers a read with the file under its `file:///` URI, and answers a
 * command or a code run WITHOUT an exit status — the case a result must not
 * paper over.
 */
function inMemoryAgentCore(): AgentCoreCodeClientLike {
  const files = new Map<string, string | Uint8Array>();
  return {
    startSession: () => Promise.resolve({ sessionId: 'example-session' }),
    invoke: (input) => {
      switch (input.name) {
        case 'writeFiles':
          for (const entry of input.arguments.content) {
            files.set(entry.path, entry.text ?? entry.blob ?? '');
          }
          return Promise.resolve({ stdout: '', stderr: '', isError: false });
        case 'readFiles': {
          const [path = ''] = input.arguments.paths;
          const data = files.get(path);
          return Promise.resolve({
            stdout: '',
            stderr: '',
            resources: [
              typeof data === 'string'
                ? { uri: `file:///${path}`, mimeType: 'text/csv', text: data }
                : { uri: `file:///${path}`, ...(data && { blob: data }) },
            ],
          });
        }
        case 'executeCommand':
          return Promise.resolve({ stdout: [...files.keys()].join('\n'), stderr: '' });
        case 'executeCode': {
          // The manifest setup prints its confirmation; the caller's own code
          // gets an answer with no exit status and no error flag.
          const setup = input.arguments.code.includes('AF_STAGED_INPUTS');
          return Promise.resolve({ stdout: setup ? 'af-staged-inputs-set\n' : '', stderr: '' });
        }
      }
    },
    stopSession: () => Promise.resolve(),
  };
}

if (isCliEntry(import.meta.url)) {
  run().then(printResult).catch(console.error);
}
