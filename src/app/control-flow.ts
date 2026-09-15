/**
 * Next's redirects are thrown, so a `catch` can swallow one.
 *
 * `redirect()` and `notFound()` work by throwing a special error that the
 * framework catches above the component. Any `try/catch` between them and the
 * framework will catch it too — and an action that turns it into "something
 * went wrong, please try again" has converted a working redirect into a dead
 * end nobody can get out of by trying again.
 *
 * That is what happened to onboarding. `claimOrganisation()` sat inside the
 * try, `requireSession()` inside it redirects a signed-out visitor to
 * `/sign-in`, and the catch reported "We could not save that. Nothing has
 * been changed — please try again." A session that had expired mid-form left
 * somebody pressing Save against a message that would never change, with no
 * hint that signing in again was the answer. It took a log line to find,
 * because the catch discarded the error too.
 *
 * The first defence is structural: call the guards BEFORE the try, so a
 * redirect cannot be caught. This is the second, for the cases where that is
 * not possible — it re-throws control flow and lets everything else be
 * handled as the error it is.
 *
 * Detected by `digest` rather than by importing Next's own `isRedirectError`,
 * which lives at an unstable internal path: the digest format is what the
 * framework puts on the wire and what its own handler matches on.
 */
export function rethrowControlFlow(error: unknown): void {
  if (typeof error !== 'object' || error === null) return;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== 'string') return;
  if (digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_REDIRECT')) {
    throw error;
  }
}
