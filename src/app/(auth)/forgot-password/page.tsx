import { ResetRequestForm } from '../ResetRequestForm';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="page-title">Reset your password</h1>
      <p className="page-sub" style={{ marginBottom: 'var(--s-5)' }}>
        Give the address you sign in with and we will email it a link to choose a new
        password.
      </p>
      <ResetRequestForm />
      <p className="hint" style={{ marginTop: 'var(--s-5)' }}>
        Remembered it? <a href="/sign-in">Sign in</a>.
      </p>
    </>
  );
}
