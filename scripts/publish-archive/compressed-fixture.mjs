import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { archiveBytes } from './archive-fixture.mjs';

// Independent data: byte-aligned DEFLATE stored blocks let the same valid TAR
// occupy an exact gzip length, including the header, block framing and trailer.
export function compressedArchiveAtSize(manifest, size) {
  assert(Number.isSafeInteger(size) && size >= 16384);
  let packed, tar, count;
  for (let delta = 0; delta < 5; delta++) {
    packed = archiveBytes(manifest, {
      extra: [['package/dist/stored', Buffer.alloc(size - 8192 - delta * 512)]],
    });
    tar = gunzipSync(packed);
    count = (size - 18 - tar.length) / 5;
    if (Number.isInteger(count)) break;
  }
  assert(Number.isSafeInteger(count) && count > 0);
  assert(Math.ceil(tar.length / count) <= 65535);
  const chunks = [packed.subarray(0, 10)];
  for (let i = 0; i < count; i++) {
    const begin = Math.floor((tar.length * i) / count),
      end = Math.floor((tar.length * (i + 1)) / count),
      length = end - begin,
      header = Buffer.alloc(5);
    header[0] = i === count - 1 ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE(length ^ 65535, 3);
    chunks.push(header, tar.subarray(begin, end));
  }
  const bytes = Buffer.concat([...chunks, packed.subarray(-8)]);
  assert.equal(bytes.length, size);
  return bytes;
}
