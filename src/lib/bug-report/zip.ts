/**
 * zipStore — a real `.zip` file, STORED (no compression), in ~150 lines and
 * zero dependencies.
 *
 * ## Why store-only is the honest choice here
 *
 * This writer exists for ONE payload: a bug-report bundle, which is JSON and
 * text. Deflate would shrink it well — and would cost this library either a
 * dependency (a zlib binding in a package that has none) or `node:zlib` (which
 * makes the export Node-only, when building the bundle in a browser is exactly
 * the flow the consent manifest is for). Store-only keeps the export
 * environment-neutral and the writer small enough to read in one sitting.
 *
 * The trade is stated rather than hidden: **a stored bundle is roughly the sum
 * of its files.** A 9 MB recording produces a ~9 MB zip. Every unzip tool reads
 * it — `unzip`, Finder, Explorer, `zipfile.ZipFile`, `jar` — because method 0
 * is the oldest thing in the format. If a bundle is too big to attach, the
 * answer is to send fewer conversations (which the manifest's trim hints name),
 * not to compress harder; that is the same answer a deflated bundle would give
 * one doubling later.
 *
 * ## What it writes, exactly
 *
 * One local file header + data per entry, then one central-directory header per
 * entry, then the end-of-central-directory record — the classic three-part
 * layout from APPNOTE.TXT, no data descriptors, no zip64, no archive comment.
 * Names are UTF-8 with the language-encoding flag (bit 11) set, so a non-ASCII
 * name is not mojibake on a reader that honours the flag.
 *
 * ## What it refuses
 *
 * A path that would escape the extraction directory (`/leading`, `..`, a drive
 * letter, a backslash) is refused BY NAME rather than written — a bug-report
 * bundle is opened by a maintainer on their own machine, and "zip slip" is the
 * one way a report could hurt the person reading it. Duplicate names, empty
 * names, an entry over 4 GB and more than 65,535 entries are refused too: those
 * are the boundaries of the non-zip64 format, and writing past them silently
 * produces a file that fails to open.
 *
 * @example
 * ```ts
 * const bytes = zipStore([
 *   { name: 'manifest.json', data: new TextEncoder().encode('{}') },
 * ]);
 * ```
 *
 * @internal Not a public export. `exportBugReport` is the door.
 */

/** One file in the archive. Directories are implied by `/` in a name. */
export interface ZipEntry {
  /** Path inside the archive, `/`-separated and relative (`docs/a.json`). */
  readonly name: string;
  /** The bytes. Text is the caller's `TextEncoder` output. */
  readonly data: Uint8Array;
}

export interface ZipStoreOptions {
  /**
   * Timestamp stamped on every entry. Default: now. Passing one makes the
   * output byte-for-byte deterministic, which is what makes a zip testable.
   * DOS timestamps start in 1980; anything earlier is clamped to it.
   */
  readonly modified?: Date;
}

/** Non-zip64 ceilings. Past either, the file this would write cannot be read. */
const MAX_ENTRY_BYTES = 0xffffffff;
const MAX_ENTRIES = 0xffff;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** 2.0 — the version that has stored + deflated entries. */
const VERSION_NEEDED = 20;
/** Bit 11: the name (and comment) are UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;

/**
 * Build a stored (uncompressed) zip archive.
 *
 * @throws TypeError naming the offending entry when a name is unsafe or
 *         duplicated, or when the archive would exceed the non-zip64 limits.
 */
export function zipStore(entries: readonly ZipEntry[], options: ZipStoreOptions = {}): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new TypeError(
      `zipStore: ${entries.length} entries exceeds the ${MAX_ENTRIES}-entry limit of a ` +
        `non-zip64 archive. Bundle fewer files (or fold them into one JSON file).`,
    );
  }

  const { dosTime, dosDate } = toDosDateTime(options.modified ?? new Date());
  const encoder = new TextEncoder();
  const seen = new Set<string>();

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = checkedName(entry.name, seen);
    seen.add(name);

    if (entry.data.length > MAX_ENTRY_BYTES) {
      throw new TypeError(
        `zipStore: entry '${name}' is ${entry.data.length} bytes, past the 4 GB ceiling of a ` +
          `non-zip64 archive. Split it, or leave it out of the bundle.`,
      );
    }

    const nameBytes = encoder.encode(name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, VERSION_NEEDED, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, METHOD_STORE, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed === uncompressed when stored
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, VERSION_NEEDED, true); // version made by
    cv.setUint16(6, VERSION_NEEDED, true); // version needed
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, METHOD_STORE, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true); // where this entry's local header sits
    central.set(nameBytes, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with the central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central directory starts after the data
  ev.setUint16(20, 0, true); // no archive comment

  return concat([...locals, ...centrals, eocd]);
}

/**
 * The one name rule: relative, `/`-separated, no traversal. A bug report is
 * extracted by the person it was filed against; this is the line between a
 * bundle and a payload.
 */
function checkedName(name: string, seen: ReadonlySet<string>): string {
  if (!name) throw new TypeError('zipStore: an entry has an empty name.');
  if (seen.has(name)) {
    throw new TypeError(
      `zipStore: two entries are both named '${name}'. A zip may hold duplicates and most ` +
        `readers silently keep the last one, so the writer refuses instead.`,
    );
  }
  const unsafe =
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-zA-Z]:/.test(name) ||
    name.split('/').includes('..');
  if (unsafe) {
    throw new TypeError(
      `zipStore: refusing the entry name '${name}'. Names must be RELATIVE and ` +
        `'/'-separated, with no '..' segment, no leading '/', no backslash and no drive ` +
        `letter — an archive is extracted on somebody else's machine, and a path that ` +
        `escapes the extraction directory is how a report hurts the person reading it.`,
    );
  }
  return name;
}

/** MS-DOS date/time, the only timestamp a base zip entry carries. */
function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const when = Number.isFinite(date.getTime()) ? date : new Date();
  const year = when.getFullYear();
  // DOS epoch is 1980. Rather than write a negative year field (which readers
  // render as garbage), clamp — the timestamp is provenance, not evidence.
  if (year < 1980) return { dosTime: 0, dosDate: (1 << 5) | 1 };
  const dosTime =
    (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  return { dosTime, dosDate };
}

/** CRC-32 (IEEE 802.3), table built once on first use. */
let crcTable: Uint32Array | undefined;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
