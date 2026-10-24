/** PR 6 command. Run data is private and all paid requests share one $4.30 ledger. */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { BudgetLedger, PRICES } from './budget.mjs';
import { budgetClient } from './transport.mjs';
import { runQueue } from './queue.mjs';
import { ROOT, codeHashes, digest, makeManifest, privatePath } from './plan.mjs';

export function argsOf(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--mode', '--bank', '--out', '--accept-ai-bank'].includes(args[i]) || !args[i + 1])
      throw new Error(
        'Use --mode prepare|mock|preflight|run --bank <private bank> --out <private folder> [--accept-ai-bank yes].',
      );
    if (Object.hasOwn(flags, args[i].slice(2))) throw new Error('Repeated command option.');
    flags[args[i].slice(2)] = args[i + 1];
  }
  if (!['prepare', 'mock', 'preflight', 'run'].includes(flags.mode) || !flags.bank || !flags.out)
    throw new Error('A mode, private bank, and private output folder are required.');
  return flags;
}
export async function loadDoors() {
  const [root, providers, observe, memory, negative] = await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/providers'),
    import('agentfootprint/observe'),
    import('agentfootprint/memory'),
    import(pathToFileURL(join(ROOT, 'dist/esm/core/agent/negativeClaims/capture.js')).href),
  ]);
  return { root, providers, observe, memory, negative };
}
export function atomicWrite(path, bytes) {
  privatePath(path);
  const temporary = `${path}.${process.pid}.partial`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}
export const writeJson = (path, value) => atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
export const readRaw = (path) => JSON.parse(gunzipSync(readFileSync(privatePath(path))));
export function completedArtifact(path, row, paid) {
  const artifact = readRaw(path);
  if (
    digest(artifact.row) !== digest(row) ||
    !Array.isArray(artifact.raw?.turns) ||
    !Array.isArray(artifact.wire) ||
    (paid && (!artifact.wire.some((w) => w.response) || artifact.wire.some((w) => w.error)))
  )
    throw new Error(
      'Existing artifact is not a complete matching trial; reconcile it before resuming.',
    );
  return artifact;
}
function assertFrozen(manifest, bankBytes) {
  if (
    manifest.bankSha256 !== digest(bankBytes) ||
    digest(manifest.codeHashes) !== digest(codeHashes())
  )
    throw new Error(
      'The registered bank or implementation changed. Do not mix it with the frozen run.',
    );
}

export async function main(argv) {
  const flags = argsOf(argv);
  const bankPath = privatePath(flags.bank);
  const out = privatePath(flags.out);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const lock = privatePath(join(out, 'run.lock'));
  const lockFd = openSync(lock, 'wx', 0o600);
  try {
    const bankBytes = readFileSync(bankPath, 'utf8');
    const { loadBank } = await import('./bank.mjs');
    const { runCase } = await import('./harness.mjs');
    const sourceBank = JSON.parse(bankBytes);
    const loaded = await loadBank(sourceBank);
    const cases = Array.isArray(loaded) ? loaded : loaded.cases;
    const byId = new Map(cases.map((c) => [c.id, c]));
    const manifestPath = privatePath(join(out, 'manifest.json'));
    if (flags.mode === 'prepare') {
      if (existsSync(manifestPath))
        throw new Error('A registration already exists; never overwrite it.');
      // Freeze the build actually executed, after rebuilding it from the pinned source.
      execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
      const manifest = makeManifest(
        cases,
        { initialAuthor: sourceBank.author_provenance, amendments: sourceBank.amendments ?? [] },
        bankBytes,
      );
      manifest.aiBankAccepted = flags['accept-ai-bank'] === 'yes';
      manifest.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      writeJson(manifestPath, manifest);
      console.log(
        JSON.stringify({
          prepared: manifest.schedule.length,
          registrationSha256: digest(manifest),
        }),
      );
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assertFrozen(manifest, bankBytes);
    if (flags.mode === 'run' && !manifest.aiBankAccepted)
      throw new Error('Paid execution needs owner acceptance of the disclosed AI-authored bank.');
    const doors = await loadDoors();
    const ledger = new BudgetLedger(join(out, 'budget.jsonl'));
    const unique = [
      ...new Map(
        manifest.schedule.map((r) => [JSON.stringify([r.caseId, r.arm, r.model, r.cell]), r]),
      ).values(),
    ];
    const plan = flags.mode === 'run' ? manifest.schedule : unique;
    const dir = privatePath(join(out, flags.mode === 'run' ? 'raw' : flags.mode));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const priorPreflight =
      flags.mode === 'run' ? JSON.parse(readFileSync(join(out, 'preflight.json'), 'utf8')) : null;
    if (
      priorPreflight &&
      (priorPreflight.registrationSha256 !== digest(manifest) ||
        priorPreflight.captured !== unique.length)
    )
      throw new Error('Complete preflight for this registration is required.');
    const captures = [];
    let done = 0;
    await runQueue(plan, 3, async (row) => {
      const path = join(dir, `${row.id}.json.gz`);
      if (existsSync(path)) {
        const saved = completedArtifact(path, row, flags.mode === 'run');
        if (flags.mode === 'preflight' && saved.wire.filter((w) => w.preflight).length !== 1)
          throw new Error(
            'Existing preflight has no unique token count; reconcile it before resuming.',
          );
        done++;
        return;
      }
      if (flags.mode === 'run' && [...ledger.entries.values()].some((e) => e.purpose === row.id))
        throw new Error(
          'A paid row has a ledger entry but no completed artifact; reconcile before retrying.',
        );
      const wire = [];
      const client = budgetClient({
        ledger,
        purpose: row.id,
        preflight: flags.mode === 'preflight',
        holdbackMicro: 1_000_000,
        onCall: (c) => wire.push(c),
      });
      const c = byId.get(row.caseId);
      const paidProvider = doors.providers.anthropic({ _client: client, defaultMaxTokens: 384 });
      const provider =
        flags.mode === 'mock'
          ? doors.providers.mock({
              reply: JSON.stringify({
                summary: 'The recorded lookup is the basis of this answer.',
                negatives: [
                  {
                    kind: c.near
                      ? 'not-found'
                      : c.oracle?.primary_stratum === 'completeness'
                      ? 'complete'
                      : 'none',
                    about: c.entity ?? c.oracle?.entity,
                    restsOn: ['r1'],
                  },
                ],
              }),
            })
          : { ...paidProvider, stream: undefined };
      let raw;
      try {
        raw = await runCase({
          doors,
          caseDef: c,
          arm: row.arm,
          cell: row.cell,
          provider,
          model: row.model,
          rep: row.rep,
        });
      } catch (error) {
        raw = { error: { name: error.name, message: error.message } };
      }
      const artifact = { row, raw, wire };
      const interrupted =
        (flags.mode === 'run' && (wire.some((w) => w.error) || !wire.some((w) => w.response))) ||
        (flags.mode === 'preflight' &&
          (wire.some((w) => w.error) || wire.filter((w) => w.preflight).length !== 1));
      atomicWrite(
        interrupted ? path.replace('.json.gz', '.interrupted.json.gz') : path,
        gzipSync(JSON.stringify(artifact)),
      );
      captures.push(
        ...wire
          .filter((w) => w.preflight)
          .map((w) => ({ row, count: w.count, bound: w.bound, paramsSha256: digest(w.params) })),
      );
      done++;
      if (interrupted) {
        writeJson(join(out, 'interrupted.json'), {
          mode: flags.mode,
          row: row.id,
          reason: 'Request, counting or budget stop',
          budget: ledger.summary(),
        });
        throw new Error(
          'Request stopped; progress is saved and any unknown charges remain reserved.',
        );
      }
      if (done % 10 === 0 || done === plan.length)
        console.log(
          JSON.stringify({ mode: flags.mode, done, total: plan.length, budget: ledger.summary() }),
        );
    });
    if (flags.mode === 'preflight') {
      // Reload saved captures on resume; no generation is sent for these requests.
      const all = unique.flatMap((r) =>
        readRaw(join(dir, `${r.id}.json.gz`))
          .wire.filter((w) => w.preflight)
          .map((w) => ({ row: r, count: w.count, bound: w.bound })),
      );
      const initialInputUsd = all.reduce(
        (sum, w) =>
          sum +
          (w.count *
            PRICES[w.row.model].input *
            (w.row.cell === 'long' ? 5 : w.row.family === 'sonnet' ? 6 : 10)) /
            1e6,
        0,
      );
      const nominalOutputUsd = manifest.schedule.reduce(
        (sum, r) => sum + (192 * PRICES[r.model].output) / 1e6,
        0,
      );
      writeJson(join(out, 'preflight.json'), {
        registrationSha256: digest(manifest),
        captured: all.length,
        expected: unique.length,
        initialInputUsd,
        nominalOutputUsd,
        warning:
          'Uncached input plus a 192-token planning allowance only; corrections and raters are additional. Per-request bounds enforce the cap. No calls have been paid for.',
        captures: all,
      });
      console.log(JSON.stringify({ preflight: all.length, initialInputUsd, nominalOutputUsd }));
    }
    writeJson(join(out, `${flags.mode}-status.json`), {
      complete: done === plan.length,
      done,
      total: plan.length,
      budget: ledger.summary(),
    });
  } finally {
    closeSync(lockFd);
    unlinkSync(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
