/**
 * The draft as the landing page promised it: every sentence with what it
 * stands on underneath, as text on the page — not a tooltip.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sentenceLabel } from '@/domain/provenance/sentence-label';

import { DraftTrace } from './DraftTrace';

const render = (props: Parameters<typeof DraftTrace>[0]): string =>
  renderToStaticMarkup(createElement(DraftTrace, props));

describe('DraftTrace', () => {
  const html = render({
    heading: 'What each sentence stands on',
    sentences: [
      {
        text: 'We work with young people aged 14 to 19 across Somerset.',
        label: sentenceLabel('supported', 'beneficiary_groups'),
      },
      { text: 'That is why this matters.', label: sentenceLabel('no_claim', null) },
      { text: 'We will reach 400 more.', label: sentenceLabel('unsupported', null) },
    ],
  });

  it('prints each sentence’s fact as visible text, not in a title attribute', () => {
    expect(html).toContain('Beneficiary groups · confirmed');
    expect(html).not.toMatch(/title="/u);
  });

  it('keeps the sentences in order, one item each', () => {
    expect(html.match(/<li /gu)).toHaveLength(3);
    expect(html.indexOf('young people')).toBeLessThan(html.indexOf('400 more'));
  });

  it('marks the unsupported sentence and the join differently from the supported one', () => {
    expect(html).toContain('trace-unsupported');
    expect(html).toContain('No confirmed fact behind this');
    expect(html).toContain('trace-join');
  });

  it('renders nothing for an answer with no breakdown', () => {
    expect(render({ heading: 'x', sentences: [] })).toBe('');
  });
});
