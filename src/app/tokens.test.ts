/**
 * Every design token referenced is a design token that exists.
 *
 * Written because a typo here is SILENT. `var(--bg)` — a token this design
 * system never had — is an invalid substitution, so the declaration falls back
 * to the inherited value: the selected tab rendered as black text on a black
 * pill, and nothing in a build, a lint or a test said a word. It took a
 * screenshot to notice and a computed-style probe to explain.
 *
 * CLAUDE.md already says not to invent values outside the tokens. This is that
 * rule, enforced.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

/**
 * Names DEFINED anywhere in the file.
 *
 * Several are declared on one line (`--r-sm: 6px; --r-md: 10px;`) and several
 * more inside media queries, so this matches a declaration wherever it sits
 * rather than assuming one per line.
 */
function definedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/(--[a-zA-Z0-9-]+)\s*:/gu)) {
    names.add(match[1]!);
  }
  return names;
}

/** Names USED, ignoring any that supply their own fallback. */
function usedNames(source: string): Map<string, number> {
  const uses = new Map<string, number>();
  for (const match of source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/gu)) {
    // `var(--x, 4px)` is deliberate and survives an undefined name, so it is
    // not a typo worth failing on.
    if (match[2] === ',') continue;
    const name = match[1]!;
    uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  return uses;
}

describe('the design tokens', () => {
  it('are all defined before they are used', () => {
    const defined = definedNames(css);
    const missing = [...usedNames(css).keys()].filter((name) => !defined.has(name)).toSorted();
    expect(missing, `used in globals.css but never defined: ${missing.join(', ')}`).toEqual([]);
  });

  it('finds a token that does not exist', () => {
    // The check has to be able to fail, or it is decoration. This is the exact
    // shape of the fault it was written for.
    const broken = ':root { --ink: #000; }\n.x { color: var(--bg); }';
    const defined = definedNames(broken);
    const missing = [...usedNames(broken).keys()].filter((name) => !defined.has(name));
    expect(missing).toEqual(['--bg']);
  });

  it('does not complain about a var() with its own fallback', () => {
    const withFallback = '.x { gap: var(--not-a-token, 4px); }';
    expect([...usedNames(withFallback).keys()]).toEqual([]);
  });

  it('reads tokens declared several to a line', () => {
    const packed = ':root { --r-sm: 6px; --r-md: 10px; }';
    expect([...definedNames(packed)]).toEqual(['--r-sm', '--r-md']);
  });
});
