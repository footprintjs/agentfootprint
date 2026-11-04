import { gzipSync } from 'node:zlib';
// Independent inert data construction, never an npm command or package helper.
export function archiveBytes(manifest, { manifestBytes, extra = [] } = {}) {
  const entries = [
    ['package/package.json', Buffer.from(manifestBytes ?? JSON.stringify(manifest))],
    ['package/dist/index.js', Buffer.from('exports.fixture = true;\n')],
    ...extra.map(([name, bytes]) => [name, Buffer.from(bytes)]),
  ];
  const chunks = [];
  for (const [name, bytes] of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    for (const at of [108, 116]) header.write('0000000\0', at, 8, 'ascii');
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(32, 148, 156);
    header[156] = 48;
    Buffer.from([117, 115, 116, 97, 114, 0, 48, 48]).copy(header, 257);
    let sum = 0;
    for (const value of header) sum += value;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]), { level: 9 });
}
