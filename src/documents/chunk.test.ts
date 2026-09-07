import { describe, expect, it } from 'vitest';

import {
  batchChunks,
  CHUNK_CONSTANTS,
  chunkPages,
  normaliseWhitespace,
  renderBatch,
  type ParsedPage,
} from './chunk.js';

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

function pages(...texts: string[]): ParsedPage[] {
  return texts.map((text, i) => ({ pageNumber: i + 1, text }));
}

describe('normaliseWhitespace', () => {
  it('collapses the runs of spaces PDF extraction leaves behind', () => {
    expect(normaliseWhitespace('We  work   across    Somerset')).toBe('We work across Somerset');
  });

  it('keeps paragraph breaks, which carry meaning', () => {
    expect(normaliseWhitespace('One\n\n\n\nTwo')).toBe('One\n\nTwo');
  });

  it('normalises Windows line endings', () => {
    expect(normaliseWhitespace('One\r\nTwo')).toBe('One\nTwo');
  });
});

describe('chunkPages', () => {
  it('keeps a short document in one chunk', () => {
    const chunks = chunkPages(pages('We were incorporated on 15 January 2020.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('15 January 2020');
    expect(chunks[0]?.pageNumber).toBe(1);
  });

  it('records the page a chunk starts on', () => {
    const chunks = chunkPages(pages(words(600), words(600)));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.pageNumber).toBe(1);
    expect(chunks.some((c) => c.pageNumber === 2)).toBe(true);
  });

  it('numbers chunks consecutively from zero', () => {
    const chunks = chunkPages(pages(words(2000)));
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('never exceeds the hard ceiling', () => {
    const chunks = chunkPages(pages(words(5000)));
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_CONSTANTS.maxChars);
    }
  });

  it('splits a wall of text with no paragraph breaks at all', () => {
    const runOn = `${'a'.repeat(CHUNK_CONSTANTS.maxChars * 2)}`;
    const chunks = chunkPages(pages(runOn));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_CONSTANTS.maxChars);
    }
  });

  it('loses no words from the source', () => {
    // The property that matters: chunking must not silently drop text, or a
    // fact goes missing and nobody can tell.
    const source = words(1500);
    const rejoined = chunkPages(pages(source))
      .map((c) => c.content)
      .join(' ');
    for (const word of ['word0', 'word749', 'word1499']) {
      expect(rejoined).toContain(word);
    }
  });

  it('overlaps consecutive chunks so a sentence across a boundary survives', () => {
    const chunks = chunkPages(pages(words(2000)));
    expect(chunks.length).toBeGreaterThan(1);
    const first = chunks[0]?.content ?? '';
    const second = chunks[1]?.content ?? '';
    // The opening of the second chunk should be text the first one ended with.
    expect(first).toContain(second.slice(0, 50));
  });

  it('skips blank pages rather than emitting empty chunks', () => {
    const chunks = chunkPages(pages('Real content here.', '   \n  \n ', 'More content.'));
    expect(chunks.every((c) => c.content.trim() !== '')).toBe(true);
  });

  it('returns nothing for a document with no text at all', () => {
    // A scanned PDF with no text layer. Honest emptiness beats a chunk of
    // whitespace that the extractor would dutifully find nothing in.
    expect(chunkPages(pages('', '  '))).toEqual([]);
  });
});

describe('batchChunks', () => {
  const many = chunkPages(pages(words(6000)));

  it('bounds each batch', () => {
    for (const batch of batchChunks(many, 6000)) {
      const size = batch.reduce((n, c) => n + c.content.length, 0);
      // One oversized chunk may exceed the target alone; two must not.
      expect(batch.length === 1 || size <= 6000).toBe(true);
    }
  });

  it('includes every chunk exactly once', () => {
    const flat = batchChunks(many, 6000).flat();
    expect(flat.map((c) => c.index)).toEqual(many.map((c) => c.index));
  });

  it('returns no batches for no chunks', () => {
    expect(batchChunks([])).toEqual([]);
  });
});

describe('renderBatch', () => {
  it('marks pages so an extracted span stays traceable', () => {
    const rendered = renderBatch([
      { index: 0, content: 'First.', pageNumber: 1 },
      { index: 1, content: 'Second.', pageNumber: 4 },
    ]);
    expect(rendered).toContain('[page 1]');
    expect(rendered).toContain('[page 4]');
  });

  it('omits the marker for a format with no pages', () => {
    expect(renderBatch([{ index: 0, content: 'Plain.', pageNumber: null }])).toBe('Plain.');
  });
});
