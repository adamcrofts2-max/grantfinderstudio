import type { ReactNode } from 'react';

/**
 * The signed-out shell.
 *
 * Deliberately without the sidebar: every link in it goes somewhere that
 * requires a session, so showing them would offer a product the visitor
 * cannot reach yet.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-panel">
        {/* Back to the front door, now that there is one. It used to point at
            sign-in, because the root redirected here anyway. */}
        <a className="brand" href="/" style={{ marginBottom: 'var(--s-6)' }}>
          <span className="brand-mark" aria-hidden="true">GF</span>
          <span>
            <span className="brand-name">Grant Finder</span>
            <br />
            <span className="brand-sub">Studio</span>
          </span>
        </a>
        {children}
      </div>
    </div>
  );
}
