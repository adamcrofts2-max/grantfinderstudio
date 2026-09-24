import { getDatabase } from '@/db';
import { authorise } from '@/app/authorise';
import { recordAudit } from '@/db/audit';
import { loadOrganisation } from '@/db/queries';
import { loadApplication } from '@/db/workspace';
import { applicationDocument } from '@/domain/export/application';
import { renderApplicationDocx } from '@/export/application-docx';

export const dynamic = 'force-dynamic';

const TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

/**
 * The application as a Word document.
 *
 * Asks before it reads anything: `application:read`, which every member of the
 * organisation has — a file of your own answers is the answers, read. The
 * tenant connection does the scoping, so an id from another organisation
 * finds nothing and gets the same 404 as one that does not exist.
 *
 * Recorded in the trail in the same transaction as the read, against the
 * application, because a copy of it has now left the product.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const who = await authorise('application:read');
  if (!who.ok) {
    return new Response('You do not have access to this application.', { status: 403, headers: TEXT });
  }
  const { id } = await params;
  const asOf = new Date().toISOString().slice(0, 10);

  const database = await getDatabase();
  const found = await database.withTenant(who.organisationId, async (tx) => {
    const application = await loadApplication(tx, id);
    if (application === null) return null;
    const organisation = await loadOrganisation(tx);
    await recordAudit(tx, who.organisationId, {
      userId: who.userId,
      action: 'application.exported',
      entityId: id,
      applicationId: id,
      metadata: { format: 'docx', questions: application.questions.length },
    });
    return { application, organisationName: organisation?.name ?? null };
  });
  if (found === null) {
    return new Response('There is no application here.', { status: 404, headers: TEXT });
  }

  const { application } = found;
  const doc = applicationDocument({
    organisationName: found.organisationName,
    fundTitle: application.opportunityTitle,
    funderName: application.funderName,
    deadline: application.deadline,
    amountRequestedGbp: application.amountRequestedGbp,
    asOf,
    questions: application.questions.map((question) => {
      const answer = application.answers.get(question.id) ?? null;
      return {
        position: question.position,
        question: question.question,
        wordLimit: question.word_limit,
        answer: answer?.content ?? null,
        wordCount: answer?.word_count ?? 0,
      };
    }),
  });

  const bytes = await renderApplicationDocx(doc);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${doc.filename}"`,
      'cache-control': 'no-store',
    },
  });
}
