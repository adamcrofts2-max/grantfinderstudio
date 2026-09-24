/**
 * Refuse a .docx that would decompress into something enormous.
 *
 * A .docx is a zip, and `mammoth` inflates the whole of it into memory. A
 * zip bomb — a few hundred kilobytes that inflate to gigabytes — therefore
 * passes the 15 MB upload limit untouched and then takes the server's memory
 * with it. The upload limit bounds what arrives, not what it becomes.
 *
 * The declared sizes in the zip's directory are the obvious check, and not a
 * sufficient one: they are just numbers in the file, and a crafted archive can
 * declare 1 KB for an entry that inflates to 1 GB. So every entry is actually
 * inflated here, with Node's `maxOutputLength` set to whatever budget is left
 * — the decompressor itself stops at the limit, whatever the headers claim.
 * That costs one extra inflation of a file already known to be small, which is
 * the price of not trusting the attacker's arithmetic.
 *
 * Only what a Word file can legitimately contain is accepted: stored or
 * deflated entries, no zip64, a sane number of entries. Anything else is
 * refused before `mammoth` sees a byte of it.
 */

import { inflateRawSync } from 'node:zlib';

export const ZIP_LIMITS = {
  /**
   * 100 MB inflated. A 15 MB Word file full of photographs inflates to little
   * more than 15 MB, because JPEGs do not compress; text-heavy ones inflate
   * perhaps tenfold. A hundred megabytes is room for any real document and a
   * bounded amount of memory for anything else.
   */
  maxInflatedBytes: 100 * 1024 * 1024,
  /** A long Word document has a few hundred parts, not tens of thousands. */
  maxEntries: 5_000,
} as const;

export class ZipGuardError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** The end-of-central-directory record: within the last 64 KB + 22 bytes. */
function findEndOfDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD) return at;
  }
  throw new ZipGuardError('That is not a Word document we can read.');
}

/**
 * Throws `ZipGuardError` unless the archive inflates to within the limits.
 * Returns the total inflated size, for the caller that wants to log it.
 */
export function checkZip(
  bytes: Uint8Array,
  limits: { maxInflatedBytes: number; maxEntries: number } = ZIP_LIMITS,
): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 22) throw new ZipGuardError('That is not a Word document we can read.');

  const end = findEndOfDirectory(view);
  const entries = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  // 0xFFFF / 0xFFFFFFFF mark zip64, which no Word file under 15 MB needs.
  if (entries === 0xffff || directoryOffset === 0xffffffff) {
    throw new ZipGuardError('That file is packed in a way a Word document never is.');
  }
  if (entries > limits.maxEntries) {
    throw new ZipGuardError('That file has far more parts than any Word document.');
  }

  let budget = limits.maxInflatedBytes;
  let at = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL) {
      throw new ZipGuardError('That is not a Word document we can read.');
    }
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    at += 46 + nameLength + extraLength + commentLength;

    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL) {
      throw new ZipGuardError('That is not a Word document we can read.');
    }
    const dataStart =
      localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > view.byteLength) {
      throw new ZipGuardError('That is not a Word document we can read.');
    }
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    let inflated: number;
    if (method === STORED) {
      inflated = compressedSize;
    } else if (method === DEFLATED) {
      try {
        inflated = inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).byteLength;
      } catch (error) {
        if (error instanceof RangeError) {
          throw new ZipGuardError('That file unpacks to far more than any Word document would.');
        }
        throw new ZipGuardError('That is not a Word document we can read.');
      }
    } else {
      throw new ZipGuardError('That file is packed in a way a Word document never is.');
    }

    budget -= inflated;
    if (budget < 0) {
      throw new ZipGuardError('That file unpacks to far more than any Word document would.');
    }
  }
  return limits.maxInflatedBytes - budget;
}
