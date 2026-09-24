import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { checkZip, ZipGuardError, ZIP_LIMITS } from './zip-guard.js';

interface Entry {
  name: string;
  data: Buffer;
  method?: 0 | 8 | 12;
  /** What the directory claims the entry inflates to — a lie, if you like. */
  declaredSize?: number;
}

/** A minimal, valid zip: local headers, a central directory, an end record. */
function zip(entries: Entry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe('checkZip', () => {
  it('passes the real Word file the parser tests use', async () => {
    const bytes = new Uint8Array(await readFile('src/documents/testing/fixtures/report.docx'));
    expect(checkZip(bytes)).toBeGreaterThan(0);
  });

  it('passes an ordinary archive and reports what it inflates to', () => {
    const bytes = zip([
      { name: 'word/document.xml', data: Buffer.from('<w:document>hello</w:document>') },
      { name: 'media/image1.png', data: Buffer.alloc(2000, 7), method: 0 },
    ]);
    expect(checkZip(bytes)).toBe(30 + 2000);
  });

  it('refuses a bomb: small on the way in, enormous on the way out', () => {
    // 20 MB of zeros deflates to about 20 KB. Against a 10 MB budget.
    const bytes = zip([{ name: 'word/document.xml', data: Buffer.alloc(20 * 1024 * 1024) }]);
    expect(bytes.byteLength).toBeLessThan(100_000);
    expect(() => checkZip(bytes, { ...ZIP_LIMITS, maxInflatedBytes: 10 * 1024 * 1024 })).toThrow(
      /unpacks to far more/u,
    );
  });

  it('does not believe the sizes the archive declares', () => {
    // Claims 10 bytes; inflates to 20 MB. The declared size is the attacker's.
    const bytes = zip([
      { name: 'word/document.xml', data: Buffer.alloc(20 * 1024 * 1024), declaredSize: 10 },
    ]);
    expect(() => checkZip(bytes, { ...ZIP_LIMITS, maxInflatedBytes: 10 * 1024 * 1024 })).toThrow(
      ZipGuardError,
    );
  });

  it('counts the whole archive against one budget, not each part on its own', () => {
    const part = Buffer.alloc(4 * 1024 * 1024);
    const bytes = zip([
      { name: 'a.xml', data: part },
      { name: 'b.xml', data: part },
      { name: 'c.xml', data: part },
    ]);
    expect(() => checkZip(bytes, { ...ZIP_LIMITS, maxInflatedBytes: 10 * 1024 * 1024 })).toThrow(
      /unpacks to far more/u,
    );
  });

  it('refuses a compression method no Word file uses', () => {
    const bytes = zip([{ name: 'x.xml', data: Buffer.from('x'), method: 12 }]);
    expect(() => checkZip(bytes)).toThrow(/packed in a way/u);
  });

  it('refuses something that is not a zip at all', () => {
    expect(() => checkZip(new TextEncoder().encode('%PDF-1.7 not a zip at all, honestly'))).toThrow(
      ZipGuardError,
    );
    expect(() => checkZip(new Uint8Array(4))).toThrow(ZipGuardError);
  });

  it('refuses an archive with absurdly many parts', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, data: Buffer.from('x') }));
    expect(() => checkZip(zip(many), { ...ZIP_LIMITS, maxEntries: 10 })).toThrow(/far more parts/u);
  });
});
