import type { ReactNode } from 'react';

import { adminSignOutAction } from './actions';

/**
 * The console's own frame.
 *
 * Deliberately unlike the customer's shell: no setup guide, no funding
 * language, and a standing line about what this console cannot see. That line
 * is not decoration — an operator who believes they are looking at customer
 * data will eventually act as if they were.
 */
export function AdminShell({
  email,
  active,
  children,
}: {
  email: string;
  active: 'overview' | 'catalogue' | 'accounts';
  children: ReactNode;
}) {
  const tab = (id: typeof active, href: string, label: string) => (
    <a className={`admin-tab${active === id ? ' is-active' : ''}`} href={href}>
      {label}
    </a>
  );

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <p className="eyebrow">Grant Finder Studio</p>
          <p className="admin-title">Console</p>
        </div>
        <form action={adminSignOutAction}>
          <span className="admin-who">{email}</span>
          <button className="btn btn-secondary btn-small" type="submit">Sign out</button>
        </form>
      </header>

      <nav className="admin-tabs" aria-label="Console">
        {tab('overview', '/admin', 'Overview')}
        {tab('catalogue', '/admin/catalogue', 'Shared catalogue')}
        {tab('accounts', '/admin/accounts', 'Accounts')}
      </nav>

      <p className="admin-boundary">
        This console reads the platform’s own tables only. It has no database privilege on any
        organisation’s profile, facts, documents or applications — a page here that asked for
        them would be refused by Postgres, not by a policy in the code.
      </p>

      {children}
    </div>
  );
}
