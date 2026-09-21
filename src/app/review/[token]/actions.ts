'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase, withAdmin } from '@/db';
import { resolveShare } from '@/db/shares';
import { addComment, countCommentsForShare, questionNumber } from '@/db/comments';
import { recordAudit } from '@/db/audit';
import { checkComment } from '@/domain/review/comments';
import { refusalMessage } from '@/domain/review/share';
import { rethrowControlFlow } from '@/app/control-flow';

import { EMPTY_COMMENT, type CommentState } from './state';

/**
 * A reviewer leaving one comment. The only write on the reviewer's path.
 *
 * ## Everything is re-derived from the token
 *
 * The form posts the token, the question id and the text, and of those three
 * only the text is taken at face value. The token is resolved again here —
 * the organisation, the application and the share id all come from that row,
 * never from the form, because the token is the only thing that authenticated
 * anybody. A form claiming a different application id gets the application
 * its token names.
 *
 * Resolved again rather than trusted from the render, too: the page that drew
 * this form may have been open for an hour, and a link withdrawn in the
 * meantime must not still be able to write. So the standing is checked on the
 * WRITE and not only on the read.
 *
 * ## What bounds it
 *
 * `checkComment` bounds the text and the count; the column bounds the text
 * again. That is the belt-and-braces rule for anything a bearer token can
 * write: a leaked link should be a nuisance somebody can withdraw, never a
 * way to fill an application with a pasted document.
 */
export async function leaveCommentAction(
  _previous: CommentState,
  formData: FormData,
): Promise<CommentState> {
  const token = String(formData.get('token') ?? '');
  const questionId = String(formData.get('questionId') ?? '');
  const raw = String(formData.get('body') ?? '');
  const general = questionId === '';
  const place = { questionId: general ? null : questionId, general };

  if (token === '') {
    return { ...EMPTY_COMMENT, ...place, message: 'This page has lost its link. Reload it.' };
  }

  const now = new Date();
  try {
    const share = await withAdmin((tx) => resolveShare(tx, token, now));
    if (share === null) {
      return { ...EMPTY_COMMENT, ...place, message: 'This review link is not one we issued.' };
    }
    if (share.standing !== 'live') {
      return { ...EMPTY_COMMENT, ...place, message: refusalMessage(share.standing) };
    }

    const database = await getDatabase();
    const outcome = await database.withTenant(share.organisationId, async (tx) => {
      const already = await countCommentsForShare(tx, share.id);
      const checked = checkComment(raw, place.questionId, already);
      if (!checked.ok) return { ok: false as const, message: checked.problem };

      const comment = await addComment(tx, share.organisationId, {
        applicationId: share.applicationId,
        shareId: share.id,
        questionId: checked.comment.questionId,
        body: checked.comment.body,
      });
      if (comment === null) {
        // `addComment` refuses a question that is not this application's —
        // which on this path means the question was deleted while the page
        // was open, not that anybody was trying it on.
        return {
          ok: false as const,
          message: 'That question is no longer part of this application. Reload the page.',
        };
      }

      const number =
        checked.comment.questionId === null
          ? null
          : await questionNumber(tx, share.applicationId, checked.comment.questionId);
      // The applicant's record of what happened to their data: a named
      // outsider wrote into their application. Shape only — the reviewer's
      // name and which question, never the words, which live in
      // `share_comments` and are read there in context.
      await recordAudit(tx, share.organisationId, {
        userId: null,
        action: 'comment.left',
        entityId: comment.id,
        applicationId: share.applicationId,
        metadata: { reviewerName: share.reviewerName, questionNumber: number },
      });
      return { ok: true as const, message: 'Sent. They will see it on their own screen.' };
    });

    // Both screens: the reviewer's own list of what they have said, and the
    // applicant's panel, which is where the comment is for.
    revalidatePath(`/review/${token}`);
    revalidatePath(`/applications/${share.applicationId}`);
    return { ...place, ok: outcome.ok, message: outcome.message };
  } catch (error) {
    rethrowControlFlow(error);
    console.error('[grantfinderstudio] the comment could not be left:', error);
    return {
      ...EMPTY_COMMENT,
      ...place,
      message: 'We could not send that. Nothing has been saved — please try again.',
    };
  }
}
