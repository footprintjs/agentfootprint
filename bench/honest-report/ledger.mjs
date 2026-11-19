import { closeSync, openSync, writeSync } from 'node:fs';

export function openAttemptLedger(path) {
  const fd = openSync(path, 'wx', 0o600);
  return {
    append(value) { writeSync(fd, `${JSON.stringify(value)}\n`); },
    close() { closeSync(fd); },
  };
}
