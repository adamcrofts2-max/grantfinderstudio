import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grant Finder Studio',
  description:
    'Funding intelligence for UK Community Interest Companies — which opportunities are worth your time, and why.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div
          role="note"
          style={{
            background: 'var(--caution-bg)',
            color: 'var(--caution)',
            borderBottom: '1px solid var(--line)',
            padding: '0.6rem 1rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          Demonstration data. Every funder, fund and award shown here is fictional
          and must not be treated as a real funding opportunity.
        </div>
        <header
          style={{
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface)',
          }}
        >
          <div
            style={{
              maxWidth: '68rem',
              margin: '0 auto',
              padding: '1rem 1.5rem',
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <a
              href="/"
              style={{
                fontWeight: 700,
                fontSize: '1.05rem',
                color: 'var(--ink)',
                textDecoration: 'none',
              }}
            >
              Grant Finder Studio
            </a>
            <span style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
              Funding intelligence for UK CICs
            </span>
          </div>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
