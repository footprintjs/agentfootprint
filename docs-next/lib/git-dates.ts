import { execFileSync } from 'node:child_process';

/** Reads `git log --format=%x00%cs --name-only`, newest first, so a file's first date is its last change. */
export function parseGitDates(log: string): Map<string, string> {
  const dates = new Map<string, string>();
  for (const entry of log.split('\0').slice(1)) {
    const [date, ...files] = entry.split('\n');
    if (!date) continue;
    for (const file of files) {
      if (file && !dates.has(file)) dates.set(file, date);
    }
  }
  return dates;
}

/**
 * When each file under `dir` last changed, for the sitemap. Empty without full history, such as a shallow CI
 * checkout: a sitemap with no date is honest, and one with the build date teaches search engines to ignore it.
 */
export function gitDatesFor(dir: string): Map<string, string> {
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    if (git('rev-parse', '--is-shallow-repository').trim() !== 'false') return new Map();
    return parseGitDates(git('log', '--format=%x00%cs', '--name-only', '--relative', '--', dir));
  } catch {
    return new Map();
  }
}
