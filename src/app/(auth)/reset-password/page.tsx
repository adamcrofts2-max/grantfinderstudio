import { ResetPasswordForm } from './ResetPasswordForm';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="page-title">Choose a new password</h1>
      <p className="page-sub" style={{ marginBottom: 'var(--s-5)' }}>
        Saving it signs you out everywhere else, in case somebody else had the old one.
      </p>
      <ResetPasswordForm />
    </>
  );
}
