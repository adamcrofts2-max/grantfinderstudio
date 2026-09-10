import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Bricolage_Grotesque } from 'next/font/google';
import './globals.css';
import { readSession } from './session';
import { signOutAction } from './(auth)/actions';
import { readSetupProgress } from './setup';

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
  // The grants come before the funder summaries deliberately: "who like us
  // has been funded" is the question people actually arrive with, and the
  // funder-level view is one level up from it.
  { href: '/grants', label: 'Search grants', icon: '⌕' },
  { href: '/funders', label: 'Who funds this', icon: '◈' },
  { href: '/opportunities/add', label: 'Add a fund', icon: '＋' },
  { href: '/tracker', label: 'Tracker', icon: '◷' },
  { href: '/applications', label: 'Applications', icon: '✎' },
  { href: '/organisation', label: 'Your organisation', icon: '⌂' },
  { href: '/documents', label: 'Documents', icon: '❒' },
  { href: '/onboarding', label: 'Find your company', icon: '⌂' },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The console is not the product. It carries its own frame, and wrapping it
  // in the customer's — a funding navigation, a setup guide, "Your next step"
  // — would tell an operator they are somewhere they are not. The path comes
  // from middleware, because a root layout is never told which page it wraps.
  const pathname = (await headers()).get('x-pathname') ?? '';
  const isConsole = pathname === '/admin' || pathname.startsWith('/admin/');

  // The shell is for signed-in people. Every link in it goes somewhere that
  // requires a session, so showing it to a visitor offers a product they
  // cannot reach — and reads as a locked door rather than a front door.
  const session = await readSession();

  // Nine destinations mean nothing to someone who has never applied for
  // funding, and meeting them with a menu is how you lose them on the first
  // screen. So until setup is finished the navigation is folded away and the
  // page carries the single next thing to do.
  //
  // Folded, not removed. Nobody is trapped: the same links are one tap under
  // "All sections", and anyone who already knows where they are going can go.
  // Null means we could not tell, and then the menu is shown — hiding it from
  // somebody who has finished would be far worse than showing it to somebody
  // who has not.
  const progress = isConsole ? null : await readSetupProgress();
  const stillSettingIn = progress !== null && !progress.complete;

  return (
    <html lang="en-GB" className={display.variable}>
      <body>
        {isConsole || session === null ? (
          children
        ) : (
          <>
            <a className="skip-link" href="#main">Skip to main content</a>
            <div className={stillSettingIn ? 'shell shell-guided' : 'shell'}>
              <nav className="sidebar" aria-label="Main">
                <a className="brand" href="/">
                  <span className="brand-mark" aria-hidden="true">GF</span>
                  <span>
                    <span className="brand-name">Grant Finder</span>
                    <br />
                    <span className="brand-sub">Studio</span>
                  </span>
                </a>
                {stillSettingIn ? (
                  <>
                    <p className="nav-progress">
                      <span className="nav-progress-count">
                        {progress.done} of {progress.total}
                      </span>
                      <span>done</span>
                    </p>
                    <details className="nav-more">
                      <summary>All sections</summary>
                      <div className="nav">
                        {NAV.map((item) => (
                          <a key={item.href} className="nav-item" href={item.href}>
                            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                            {item.label}
                          </a>
                        ))}
                        <form action={signOutAction}>
                          <button className="nav-item nav-signout" type="submit">
                            <span className="nav-icon" aria-hidden="true">⇥</span>
                            Sign out
                          </button>
                        </form>
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="nav">
                      <span className="nav-label">Funding</span>
                      {NAV.map((item) => (
                        <a key={item.href} className="nav-item" href={item.href}>
                          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                          {item.label}
                        </a>
                      ))}
                    </div>
                    <form action={signOutAction} className="nav-foot">
                      <button className="nav-item nav-signout" type="submit">
                        <span className="nav-icon" aria-hidden="true">⇥</span>
                        Sign out
                      </button>
                    </form>
                  </>
                )}
              </nav>
              <div className="main">
                {/* Unmissable, on every screen, and sticky.
                    A populated sandbox looks exactly like a real
                    organisation's account — which is the point, and also the
                    danger: a screenshot of it could be shown as a customer's
                    work, or read as real data by whoever is looking over the
                    operator's shoulder. So the label travels with the content
                    rather than sitting on one screen. */}
                {session.sandbox ? (
                  <p className="sandbox-bar">
                    <span aria-hidden="true">◆</span>
                    <span>
                      <strong>Sandbox.</strong> This is your own practice
                      organisation, not a customer’s. Nothing here is real.
                    </span>
                    <a href="/admin/sandbox">Back to the console</a>
                  </p>
                ) : null}
                <main id="main">{children}</main>
              </div>
            </div>
          </>
        )}
      </body>
    </html>
  );
}
