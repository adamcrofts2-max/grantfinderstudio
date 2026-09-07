import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grant Finder Studio',
  description:
    'Funding intelligence for UK Community Interest Companies — which opportunities are worth your time, and why.',
};

const NAV = [
  { href: '/', label: 'Opportunities', icon: '◎' },
  { href: '/organisation', label: 'Your organisation', icon: '⌂' },
  { href: '/onboarding', label: 'Find your company', icon: '⌕' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        <div className="shell">
          <nav className="sidebar" aria-label="Main">
            <a className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">GF</span>
              <span>
                <span className="brand-name">Grant Finder</span>
                <br />
                <span className="brand-sub">Studio</span>
              </span>
            </a>
            <div className="nav">
              <span className="nav-label">Funding</span>
              {NAV.map((item) => (
                <a key={item.href} className="nav-item" href={item.href}>
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </a>
              ))}
            </div>
          </nav>
          <div className="main">
            <main id="main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
