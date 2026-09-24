import { redirect } from 'next/navigation';

import { readSession } from '@/app/session';
import { signInAction } from '../actions';
import { AuthForm } from '../AuthForm';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Somebody already signed in has no business on this page.
  if ((await readSession()) !== null) redirect('/');
  const { reset } = await searchParams;

  return (
    <>
      <h1 className="page-title">Sign in</h1>
      <p className="page-sub" style={{ marginBottom: 'var(--s-5)' }}>
        Your organisation, its facts and its applications are yours alone. Nobody
        else can see them.
      </p>
      {reset === 'done' ? (
        <p className="notice notice-neutral" role="status" style={{ marginBottom: 'var(--s-4)' }}>
          <span>Your password has been changed. Sign in with the new one.</span>
        </p>
      ) : null}
      <AuthForm action={signInAction} mode="sign-in" />
      <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p className="hint" style={{ marginTop: 'var(--s-2)' }}>
        No account yet? <a href="/sign-up">Create one</a>.
      </p>
    </>
  );
}
