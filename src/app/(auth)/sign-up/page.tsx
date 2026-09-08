import { redirect } from 'next/navigation';

import { readSession } from '@/app/session';
import { signUpAction } from '../actions';
import { AuthForm } from '../AuthForm';

export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  if ((await readSession()) !== null) redirect('/');

  return (
    <>
      <h1 className="page-title">Create an account</h1>
      <p className="page-sub" style={{ marginBottom: 'var(--s-5)' }}>
        Next you will tell us about your organisation, and everything the
        product does — eligibility, effort, deadlines — is worked out from that.
      </p>
      <AuthForm action={signUpAction} mode="sign-up" />
      <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
        Already have an account? <a href="/sign-in">Sign in</a>.
      </p>
    </>
  );
}
