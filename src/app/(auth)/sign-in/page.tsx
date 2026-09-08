import { redirect } from 'next/navigation';

import { readSession } from '@/app/session';
import { signInAction } from '../actions';
import { AuthForm } from '../AuthForm';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  // Somebody already signed in has no business on this page.
  if ((await readSession()) !== null) redirect('/');

  return (
    <>
      <h1 className="page-title">Sign in</h1>
      <p className="page-sub" style={{ marginBottom: 'var(--s-5)' }}>
        Your organisation, its facts and its applications are yours alone. Nobody
        else can see them.
      </p>
      <AuthForm action={signInAction} mode="sign-in" />
      <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
        No account yet? <a href="/sign-up">Create one</a>.
      </p>
    </>
  );
}
