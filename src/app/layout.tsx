import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Bricolage_Grotesque } from 'next/font/google';
import './globals.css';

/**
 * The display face.
 *
 * Self-hosted through next/font rather than a stylesheet link: the file is
 * served from our own origin, so there is no third-party request on every page
 * load and no flash of the fallback while it arrives. Body copy stays on the
 * system stack — it is set at 15px and read for long stretches, and the system
 * face is better at that than anything we would ship.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Grant Finder Studio',
  description:
    'Funding intelligence for UK Community Interest Companies — which opportunities are worth your time, and why.',
};

const NAV = [
  { href: '/', label: 'Opportunities', icon: '◎' },
  { href: '/funders', label: 'Who funds this', icon: '◈' },
  { href: '/opportunities/add', label: 'Add a fund', icon: '＋' },
  { href: '/tracker', label: 'Tracker', icon: '◷' },
  { href: '/applications', label: 'Applications', icon: '✎' },
  { href: '/organisation', label: 'Your organisation', icon: '⌂' },
  { href: '/documents', label: 'Documents', icon: '❒' },
  { href: '/onboarding', label: 'Find your company', icon: '⌕' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={display.variable}>
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
