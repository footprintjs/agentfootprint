/** Exclusive, append-only durable journal. No resume/reset/refund path. */
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
export function openJournal(path) {
  const fd = openSync(path, 'wx', 0o600);
  let closed = false;
  return {
    append(event) {
      if (closed) throw new Error('pilot journal closed');
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      if (bytes.length > 32_768) throw new Error('pilot journal row cap');
      let written = 0;
      while (written < bytes.length) {
        const count = writeSync(fd, bytes, written, bytes.length - written);
        if (count === 0) throw new Error('pilot journal short write');
        written += count;
      }
      fsyncSync(fd);
    },
    close() {
      if (!closed) {
        closed = true;
        closeSync(fd);
      }
    },
  };
}
