'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getDatabase } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { recordAudit } from '@/db/audit';
import { addQuestions, loadApplication, loadFacts, saveAnswer, type NewQuestion } from '@/db/workspace';
import { addBudgetLine, deleteBudgetLine } from '@/db/budget';
import { addOutcome, deleteOutcome } from '@/db/outcomes';
import { saveReview } from '@/db/reviews';
import { createShare, revokeShare } from '@/db/shares';
import { loadComments, questionNumber, setCommentHandled } from '@/db/comments';
import { createShareToken, hashShareToken } from '@/auth/token';
import { isShareLength, SHARE_DAYS, shareExpiry } from '@/domain/review/share';
import { isCostCategory } from '@/domain/budget/categories';
import { rethrowControlFlow } from '@/app/control-flow';
import { claimStanding, countUnsupported, usableFacts } from '@/domain/provenance/facts';
import { MAX_ANSWER_LENGTH, countWords } from '@/domain/questions/words';
import { draftSummary } from '@/domain/provenance/draft-summary';
import { providerFromStore } from '@/ai/provider-from-store';
import { runAgent } from '@/ai/run';
import { buildWriterPrompt, checkDraft, WRITER } from '@/ai/agents/writer';
import {
  buildCriticPrompt,
  bySeverity,
  CRITIC,
  keepCheckableFindings,
  RED_TEAM,
} from '@/ai/agents/critic';
import { loadVerifiedCriteriaLabels } from '@/db/workspace';
import {
  EMPTY_DRAFT,
  EMPTY_EDIT,
  EMPTY_REVIEW,
  EMPTY_SHARE,
  EMPTY_WRITE,
  type AddState,
  type DraftState,
  type EditState,
  type ReviewState,
  type ShareFormState,
  type WriteState,
} from './state';

/**
 * Draft one answer.
 *
 * The Writer sees only confirmed facts, and every sentence it returns is
 * checked against the facts actually supplied before anything is stored. A
 * draft citing a source we never provided is refused outright rather than
 * saved with a warning — that citation is the signature of a fabrication, and
 * a stored draft is one step from a submitted one.
 */
export async function draftAnswerAction(
  _previous: DraftState,
  formData: FormData,
): Promise<DraftState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const questionId = String(formData.get('questionId') ?? '');
  const applicationId = String(formData.get('applicationId') ?? '');
  if (questionId === '' || applicationId === '') {
    return { ...EMPTY_DRAFT, message: 'No question selected.' };
  }

  const provider = await providerFromStore();
  if (!provider.available) {
    return { ...EMPTY_DRAFT, questionId, message: provider.reason };
  }

  const database = await getDatabase();
  const prepared = await database.withTenant(organisationId, async (tx) => {
    const application = await loadApplication(tx, applicationId);
    return {
      question: application?.questions.find((q) => q.id === questionId) ?? null,
      facts: await loadFacts(tx),
    };
  });

  if (prepared.question === null) {
    return { ...EMPTY_DRAFT, questionId, message: 'That question no longer exists.' };
  }

  const confirmed = usableFacts(prepared.facts);
  if (confirmed.length === 0) {
    return {
      ...EMPTY_DRAFT,
      questionId,
      message:
        'You have no confirmed facts yet, so there is nothing to write from. Confirm some on the Your organisation page first.',
    };
  }

  const context = {
    question: prepared.question.question,
    assesses: prepared.question.assesses,
    wordLimit: prepared.question.word_limit,
    facts: confirmed,
  };

  let sentences: Array<{ text: string; factId: string | null; unsupported: boolean }>;
  let checked: ReturnType<typeof checkDraft>;
  try {
    const result = await runAgent(provider.provider, WRITER, buildWriterPrompt(context));
    sentences = result.output.sentences;
    checked = checkDraft(result.output, context);
  } catch (error) {
    return {
      ...EMPTY_DRAFT,
      questionId,
      message: `Drafting failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  const fabricated = checked.issues.filter((issue) => issue.kind === 'unknown_fact');
  if (fabricated.length > 0) {
    return {
      ...EMPTY_DRAFT,
      questionId,
      message: `The draft cited a source we never supplied, so nothing was saved. ${fabricated[0]?.detail ?? ''}`,
    };
  }

  const byId = new Map(confirmed.map((fact) => [fact.id, fact]));

  await database.withTenant(organisationId, async (tx) => {
    await saveAnswer(
      tx,
      organisationId,
      {
        questionId,
        content: checked.text,
        wordCount: checked.wordCount,
        claims: sentences.map((s) => ({ text: s.text, factId: s.factId })),
      },
      userId,
    );
    // Drafted rather than written, and how many of its sentences are traced
    // to a confirmed fact — which is the thing anybody reviewing this would
    // want to know about a machine-written answer.
    await recordAudit(tx, organisationId, {
      userId,
      action: 'answer.drafted',
      entityId: questionId,
      applicationId,
      metadata: {
        wordCount: checked.wordCount,
        sentences: sentences.length,
        grounded: sentences.filter((sentence) => sentence.factId !== null).length,
      },
    });
  });

  revalidatePath(`/applications/${applicationId}`);

  // Everything the summary needs, and nothing decided here: the sentence and
  // the counts come out of one pure function so they cannot disagree. See
  // `draftSummary` for the contradiction that made that necessary.
  const notes: string[] = [];
  const over = checked.issues.find((issue) => issue.kind === 'over_word_limit');
  if (over) notes.push(over.detail);
  const repeated = checked.issues.filter((issue) => issue.kind === 'repeated_fact');
  if (repeated.length > 0) {
    notes.push(`${repeated.length} fact${repeated.length === 1 ? ' is' : 's are'} stated more than once.`);
  }

  const standings = sentences.map((s) => claimStanding(s.factId, confirmed));

  return {
    questionId,
    ok: true,
    message: draftSummary({
      wordCount: checked.wordCount,
      traced: standings.filter((standing) => standing === 'supported').length,
      unsupported: countUnsupported(standings),
      notes,
    }),
    claims: sentences.map((s, index) => ({
      text: s.text,
      factId: s.factId,
      factLabel: s.factId === null ? null : (byId.get(s.factId)?.claim ?? null),
      // The same function the page uses, so a draft just written and the same
      // draft read back tomorrow cannot disagree about what is supported.
      standing: standings[index] ?? claimStanding(s.factId, confirmed),
    })),
    gaps: checked.gaps,
    wordCount: checked.wordCount,
  };
}

/**
 * Save an answer the applicant wrote themselves.
 *
 * ## Why this exists
 *
 * It did not, and the product promised it on three screens: "or write every
 * answer yourself", "every answer stays yours to write from a blank box", and
 * the tracker's whole effort model, which "assumes you write every answer
 * yourself, at about 200 words an hour". The application screen offered one
 * action per question — draft it — so on a deployment with no Anthropic key,
 * which is the default, there was nothing a person could do with a parsed
 * form at all.
 *
 * ## The provenance rule this has to respect
 *
 * `saveAnswer` replaces an answer's `answer_fact_refs` with whatever claims
 * it is handed, so passing NONE deletes them — and that is exactly right.
 * Sentence-by-sentence tracing describes text the Writer produced against the
 * facts it was given; it says nothing true about text somebody typed
 * afterwards. Keeping the old refs over edited prose would leave the screen
 * highlighting sentences that are no longer there and crediting facts to
 * words nobody checked, which is the fabrication this product exists to
 * refuse. So writing your own answer clears the tracing, the card says so,
 * and that is a smaller loss than a citation that has come loose.
 */
export async function saveOwnAnswerAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const questionId = String(formData.get('questionId') ?? '');
  const applicationId = String(formData.get('applicationId') ?? '');
  const content = String(formData.get('content') ?? '');

  if (questionId === '' || applicationId === '') {
    return { ...EMPTY_WRITE, message: 'No question selected.' };
  }
  if (content.length > MAX_ANSWER_LENGTH) {
    return {
      ...EMPTY_WRITE,
      questionId,
      message: `That is longer than ${MAX_ANSWER_LENGTH.toLocaleString('en-GB')} characters, so it was not saved. Shorten it, or keep the rest somewhere else.`,
    };
  }

  const database = await getDatabase();

  // The question has to belong to this organisation's application. RLS would
  // refuse a write across tenants anyway, but a missing question and somebody
  // else's question should not read the same to whoever is looking.
  const question = await database.withTenant(organisationId, async (tx) => {
    const application = await loadApplication(tx, applicationId);
    return application?.questions.find((q) => q.id === questionId) ?? null;
  });
  if (question === null) {
    return { ...EMPTY_WRITE, questionId, message: 'That question no longer exists.' };
  }

  const wordCount = countWords(content);

  await database.withTenant(organisationId, async (tx) => {
    await saveAnswer(
      tx,
      organisationId,
      // No claims: see the provenance rule above. This deletes the refs from
      // any previous draft, which is the point rather than a side effect.
      { questionId, content, wordCount, claims: [] },
      userId,
    );
    // A COUNT, not the words. `answer_versions` already keeps every save; the
    // trail says that a save happened and how long it was. Copying the prose
    // in here would make a second, unversioned store of the applicant's
    // writing — and hand it to whoever the application gets shared with.
    await recordAudit(tx, organisationId, {
      userId,
      action: 'answer.saved',
      entityId: questionId,
      applicationId,
      metadata: { wordCount, wordLimit: question.word_limit },
    });
  });

  revalidatePath(`/applications/${applicationId}`);

  const over =
    question.word_limit !== null && wordCount > question.word_limit
      ? ` That is over their limit of ${question.word_limit}.`
      : '';
  return {
    questionId,
    ok: true,
    message:
      wordCount === 0
        ? 'Cleared. There is no answer saved for this question now.'
        : `Saved ${wordCount} word${wordCount === 1 ? '' : 's'}, in your own words.${over}`,
    wordCount,
  };
}

/**
 * Save questions the applicant pasted from a funder's form.
 *
 * Parsing happens in the browser so they can see and correct it first; this
 * receives the reviewed result. It re-validates rather than trusting the
 * posted shape — the browser is not a trustworthy source.
 */
export async function addQuestionsAction(
  _previous: AddState,
  formData: FormData,
): Promise<AddState> {
  const organisationId = await requireOrganisationId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const payload = String(formData.get('questions') ?? '');
  if (applicationId === '' || payload === '') {
    return { ok: false, message: 'Nothing to add.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, message: 'Those questions could not be read. Try pasting again.' };
  }

  const questions: NewQuestion[] = [];
  if (!Array.isArray(parsed)) {
    return { ok: false, message: 'Those questions could not be read. Try pasting again.' };
  }
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const question = typeof record['question'] === 'string' ? record['question'].trim() : '';
    if (question === '') continue;
    const limit = record['wordLimit'];
    questions.push({
      question: question.slice(0, 2000),
      wordLimit: typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null,
      guidance:
        typeof record['guidance'] === 'string' && record['guidance'].trim() !== ''
          ? record['guidance'].trim().slice(0, 4000)
          : null,
    });
  }

  if (questions.length === 0) {
    return { ok: false, message: 'No usable questions were found in that paste.' };
  }

  const database = await getDatabase();
  const userId = await requireUserId();
  await database.withTenant(organisationId, async (tx) => {
    await addQuestions(tx, organisationId, applicationId, questions);
    await recordAudit(tx, organisationId, {
      userId,
      action: 'application.questions_added',
      entityId: applicationId,
      applicationId,
      metadata: {
        added: questions.length,
        withWordLimit: questions.filter((q) => q.wordLimit !== null).length,
      },
    });
  });

  revalidatePath(`/applications/${applicationId}`);
  return {
    ok: true,
    message: `Added ${questions.length} question${questions.length === 1 ? '' : 's'}.`,
  };
}

/** Bounds on what a person can type into a budget line or an outcome. */
const MAX_LINE_TEXT = 300;
const MAX_OUTCOME_TEXT = 600;
/** £100m. A bound, not a judgement: it stops a typo becoming a total. */
const MAX_LINE_AMOUNT = 100_000_000;

/** The application, if it is this organisation's. Used by all four editors. */
async function ownApplication(
  organisationId: string,
  applicationId: string,
): Promise<boolean> {
  const database = await getDatabase();
  return database.withTenant(
    organisationId,
    async (tx) => (await loadApplication(tx, applicationId)) !== null,
  );
}

/**
 * Add a line to the budget.
 *
 * ## Why the amount is parsed rather than trusted
 *
 * People type "£1,200" and "1200.00" and "1,200" into a money field, and a
 * number input does not stop any of them arriving as text. The commas and the
 * pound sign come off here; anything left that is not a number is a message
 * rather than a NaN travelling to a numeric column.
 */
export async function addBudgetLineAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const organisationId = await requireOrganisationId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const category = formData.get('category');
  const description = String(formData.get('description') ?? '').trim();
  const rawAmount = String(formData.get('amountGbp') ?? '').trim();

  if (applicationId === '' || !(await ownApplication(organisationId, applicationId))) {
    return { ...EMPTY_EDIT, message: 'That application no longer exists.' };
  }
  if (!isCostCategory(category)) {
    return { ...EMPTY_EDIT, field: 'category', message: 'Choose what kind of cost this is.' };
  }
  if (description === '') {
    return {
      ...EMPTY_EDIT,
      field: 'description',
      message: 'Say what the money buys — an assessor reads this line, not the category.',
    };
  }

  const amount = Number(rawAmount.replaceAll(/[£,\s]/gu, ''));
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ...EMPTY_EDIT,
      field: 'amountGbp',
      message: 'Give an amount in pounds, greater than zero.',
    };
  }
  if (amount > MAX_LINE_AMOUNT) {
    return {
      ...EMPTY_EDIT,
      field: 'amountGbp',
      message: 'That is larger than any grant we have seen. Check the figure.',
    };
  }

  const database = await getDatabase();
  const userId = await requireUserId();
  await database.withTenant(organisationId, async (tx) => {
    const lineId = await addBudgetLine(tx, organisationId, applicationId, {
      category,
      description: description.slice(0, MAX_LINE_TEXT),
      // Two decimal places, because the column is numeric(12,2) and rounding
      // at the boundary is better than the database doing it silently.
      amountGbp: Math.round(amount * 100) / 100,
    });
    await recordAudit(tx, organisationId, {
      userId,
      action: 'budget_line.added',
      entityId: lineId,
      applicationId,
      metadata: { category, amountGbp: Math.round(amount * 100) / 100 },
    });
  });

  revalidatePath(`/applications/${applicationId}`);
  return { ok: true, message: `Added "${description.slice(0, 60)}".` };
}

export async function removeBudgetLineAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const organisationId = await requireOrganisationId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const lineId = String(formData.get('lineId') ?? '');
  if (applicationId === '' || lineId === '') {
    return { ...EMPTY_EDIT, message: 'Nothing to remove.' };
  }

  const database = await getDatabase();
  const userId = await requireUserId();
  const removed = await database.withTenant(organisationId, async (tx) => {
    const gone = await deleteBudgetLine(tx, applicationId, lineId);
    // Only when something was actually removed. A trail that records every
    // attempted delete, including the ones that found nothing, says a row was
    // removed twice and cannot be reconciled against the budget.
    if (gone) {
      await recordAudit(tx, organisationId, {
        userId,
        action: 'budget_line.removed',
        entityId: lineId,
        applicationId,
      });
    }
    return gone;
  });
  revalidatePath(`/applications/${applicationId}`);
  return removed
    ? { ok: true, message: 'Removed.' }
    : { ...EMPTY_EDIT, message: 'That line had already gone.' };
}

/**
 * Add one row of the logic model.
 *
 * Activity, output and outcome are all required because the point of the row
 * is the distinction between them. An indicator and a target are optional:
 * plenty of funders do not ask, and a blank is honest where an invented
 * measure would not be.
 */
export async function addOutcomeAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const organisationId = await requireOrganisationId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const text = (name: string): string =>
    String(formData.get(name) ?? '').trim().slice(0, MAX_OUTCOME_TEXT);
  const activity = text('activity');
  const output = text('output');
  const outcome = text('outcome');
  const indicator = text('indicator');
  const target = text('target');

  if (applicationId === '' || !(await ownApplication(organisationId, applicationId))) {
    return { ...EMPTY_EDIT, message: 'That application no longer exists.' };
  }
  for (const [field, value, prompt] of [
    ['activity', activity, 'Say what you will actually do.'],
    ['output', output, 'Say what that produces — how many, how often.'],
    ['outcome', outcome, 'Say what changes for somebody as a result.'],
  ] as const) {
    if (value === '') return { ...EMPTY_EDIT, field, message: prompt };
  }

  const database = await getDatabase();
  const userId = await requireUserId();
  await database.withTenant(organisationId, async (tx) => {
    const outcomeId = await addOutcome(tx, organisationId, applicationId, {
      activity,
      output,
      outcome,
      indicator: indicator === '' ? null : indicator,
      target: target === '' ? null : target,
    });
    await recordAudit(tx, organisationId, {
      userId,
      action: 'outcome.added',
      entityId: outcomeId,
      applicationId,
      metadata: { hasIndicator: indicator !== '', hasTarget: target !== '' },
    });
  });

  revalidatePath(`/applications/${applicationId}`);
  return { ok: true, message: 'Added.' };
}

export async function removeOutcomeAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const organisationId = await requireOrganisationId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const id = String(formData.get('outcomeId') ?? '');
  if (applicationId === '' || id === '') {
    return { ...EMPTY_EDIT, message: 'Nothing to remove.' };
  }

  const database = await getDatabase();
  const userId = await requireUserId();
  const removed = await database.withTenant(organisationId, async (tx) => {
    const gone = await deleteOutcome(tx, applicationId, id);
    if (gone) {
      await recordAudit(tx, organisationId, {
        userId,
        action: 'outcome.removed',
        entityId: id,
        applicationId,
      });
    }
    return gone;
  });
  revalidatePath(`/applications/${applicationId}`);
  return removed
    ? { ok: true, message: 'Removed.' }
    : { ...EMPTY_EDIT, message: 'That row had already gone.' };
}

/**
 * Review the whole application before it goes in.
 *
 * The free first step on the path to paid human review: the machine takes the
 * mechanical and structural faults so that a person's time — and later a paid
 * bid writer's — is spent on judgement rather than on noticing a word count.
 *
 * Findings that quote words the application does not contain are dropped
 * before the applicant ever sees them. A criticism of an invented sentence is
 * the review equivalent of a fabricated citation.
 */
export async function reviewApplicationAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const mode = formData.get('mode') === 'red_team' ? 'red_team' : 'standard';
  // Posted by the panel, which is rendered inside the page that computed it.
  // Recomputing it here would mean loading the budget, the outcomes and the
  // criteria again to arrive at a number already on the screen.
  const posted = Number(formData.get('readinessPercent') ?? '');
  const readinessPercent =
    Number.isInteger(posted) && posted >= 0 && posted <= 100 ? posted : null;
  if (applicationId === '') return { ...EMPTY_REVIEW, ok: false, message: 'No application.' };

  const provider = await providerFromStore();
  if (!provider.available) return { ...EMPTY_REVIEW, ok: false, message: provider.reason };

  const database = await getDatabase();
  const loaded = await database.withTenant(organisationId, async (tx) => {
    const application = await loadApplication(tx, applicationId);
    if (application === null) return null;
    const criteria =
      application.opportunityId === null
        ? []
        : await loadVerifiedCriteriaLabels(tx, application.opportunityId);
    return { application, criteria };
  });

  if (loaded === null) return { ...EMPTY_REVIEW, ok: false, message: 'Application not found.' };
  const { application, criteria } = loaded;

  const answered = application.questions.map((question) => ({
    position: question.position,
    question: question.question,
    answer: application.answers.get(question.id)?.content ?? '',
  }));

  if (answered.every((q) => q.answer.trim() === '')) {
    return {
      ...EMPTY_REVIEW,
      ok: false,
      message: 'There is nothing to review yet — draft an answer or two first.',
    };
  }

  try {
    const definition = mode === 'red_team' ? RED_TEAM : CRITIC;
    const result = await runAgent(
      provider.provider,
      definition,
      buildCriticPrompt({
        opportunityTitle: application.opportunityTitle ?? 'this fund',
        funderName: application.funderName ?? 'the funder',
        criteriaLabels: criteria,
        questions: answered,
      }),
    );

    const answers = answered.map((q) => q.answer);
    const checked = keepCheckableFindings(result.output, answers);
    const findings = [...checked.findings].toSorted(bySeverity);
    const message =
      checked.findings.length === 0
        ? 'Nothing found. That is worth a second read by a person before you rely on it.'
        : `${checked.findings.length} ${checked.findings.length === 1 ? 'thing' : 'things'} to look at.`;

    // KEPT, because it cost a model call. A review used to live in
    // `useActionState` and be gone the moment somebody navigated away, so
    // working through a finding the next evening meant paying for the whole
    // review again. `readinessPercent` is stamped with it so the panel can
    // later say what has moved since.
    //
    // Stored only after `keepCheckableFindings` has had it: a finding quoting
    // words the application does not contain is discarded before it reaches
    // the screen, and one that never reached the screen has no business
    // surviving in the record.
    await database.withTenant(organisationId, async (tx) => {
      await saveReview(tx, organisationId, applicationId, {
        mode,
        summary: message,
        findings,
        mostImportant: checked.mostImportant,
        strengths: checked.strengths,
        injected: checked.instructionLikeContent,
        readinessPercent: readinessPercent ?? null,
      });
      // A review costs a model call, so a record of how many were run and in
      // which mode is worth having on its own. The findings are in `reviews`;
      // this is the event.
      await recordAudit(tx, organisationId, {
        userId,
        action: 'review.read',
        entityId: applicationId,
        applicationId,
        metadata: {
          mode,
          findings: findings.length,
          discarded: result.output.findings.length - checked.findings.length,
          readinessPercent: readinessPercent ?? null,
        },
      });
    });
    revalidatePath(`/applications/${applicationId}`);

    return {
      ok: true,
      message,
      mode,
      findings,
      mostImportant: checked.mostImportant,
      strengths: checked.strengths,
      injected: checked.instructionLikeContent,
      discarded: result.output.findings.length - checked.findings.length,
    };
  } catch (error) {
    rethrowControlFlow(error);
    console.error('[grantfinderstudio] the review could not be completed:', error);
    return { ...EMPTY_REVIEW, ok: false, message: 'The review could not be completed. Nothing has changed.' };
  }
}

/**
 * The absolute URL to hand somebody.
 *
 * A reviewer is outside the product and may be outside the organisation, so a
 * path is no use to them — it goes into an email. The host comes from the
 * request rather than from configuration because this deploys behind a proxy
 * that sets it, and because a hardcoded host is wrong on every preview
 * deployment and in development.
 *
 * `x-forwarded-host` before `host`: behind a proxy the latter is the internal
 * one. A forged header can only produce a link that does not work for the
 * person who forged it — the token is already in their hand — so this is not
 * a trust boundary, only a convenience.
 */
async function absoluteUrl(path: string): Promise<string> {
  const jar = await headers();
  const host = jar.get('x-forwarded-host') ?? jar.get('host');
  if (host === null || host.trim() === '') return path;
  const proto = jar.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}${path}`;
}

/**
 * Share one application, read-only, with somebody the applicant names.
 *
 * The token is minted here, hashed before it is stored, and returned to the
 * caller exactly once — this response. Nothing can show it again, which is
 * the property that makes the stored table useless to steal.
 */
export async function createShareAction(
  _previous: ShareFormState,
  formData: FormData,
): Promise<ShareFormState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const reviewerName = String(formData.get('reviewerName') ?? '').trim().slice(0, 120);
  const posted = Number(formData.get('days'));
  // Anything not on the list becomes the default rather than an error, and
  // certainly not whatever was posted — see `shareExpiry`.
  const days = isShareLength(posted) ? posted : SHARE_DAYS;

  if (applicationId === '') {
    return { ...EMPTY_SHARE, message: 'No application to share.' };
  }
  if (reviewerName === '') {
    return {
      ...EMPTY_SHARE,
      message: 'Say who this is for, so you can tell your links apart later.',
      field: 'reviewerName',
    };
  }

  const database = await getDatabase();
  const token = createShareToken();
  const now = new Date();

  try {
    const created = await database.withTenant(organisationId, async (tx) => {
      // The application has to be this organisation's. RLS already guarantees
      // it, and checking here means an id from somewhere else is a message
      // rather than a foreign-key error.
      const application = await loadApplication(tx, applicationId);
      if (application === null) return null;
      const share = await createShare(tx, organisationId, {
        applicationId,
        reviewerName,
        tokenHash: hashShareToken(token),
        expiresAt: shareExpiry(now, days),
        createdBy: userId,
      });
      await recordAudit(tx, organisationId, {
        userId,
        action: 'share.created',
        entityId: share.id,
        applicationId,
        // The name the applicant typed and the length they chose. Not the
        // token, and not its hash: a trail is read by the reviewer too.
        metadata: { reviewerName, days },
      });
      return share;
    });

    if (created === null) {
      return { ...EMPTY_SHARE, message: 'That application no longer exists.' };
    }

    revalidatePath(`/applications/${applicationId}`);
    return {
      ok: true,
      message: `Ready for ${reviewerName}. Copy the link now — we cannot show it again.`,
      link: await absoluteUrl(`/review/${token}`),
    };
  } catch (error) {
    rethrowControlFlow(error);
    console.error('[grantfinderstudio] the share could not be created:', error);
    return {
      ...EMPTY_SHARE,
      message: 'We could not create that link. Nothing has been shared — please try again.',
    };
  }
}

/**
 * Withdraw a share.
 *
 * Takes effect on the reviewer's next request; there is no session to end,
 * because a share never had one. The row stays — it is the applicant's own
 * record of who was given access and when it stopped.
 */
export async function revokeShareAction(
  _previous: ShareFormState,
  formData: FormData,
): Promise<ShareFormState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const shareId = String(formData.get('shareId') ?? '');
  const reviewerName = String(formData.get('reviewerName') ?? '').trim().slice(0, 120);
  if (applicationId === '' || shareId === '') {
    return { ...EMPTY_SHARE, message: 'Nothing to withdraw.' };
  }

  const database = await getDatabase();
  try {
    const withdrawn = await database.withTenant(organisationId, async (tx) => {
      const gone = await revokeShare(tx, applicationId, shareId);
      if (gone) {
        await recordAudit(tx, organisationId, {
          userId,
          action: 'share.revoked',
          entityId: shareId,
          applicationId,
          metadata: reviewerName === '' ? {} : { reviewerName },
        });
      }
      return gone;
    });
    revalidatePath(`/applications/${applicationId}`);
    return withdrawn
      ? {
          ok: true,
          link: null,
          message: `Withdrawn. ${reviewerName === '' ? 'That link' : reviewerName} cannot open it again.`,
        }
      : { ...EMPTY_SHARE, message: 'That link had already stopped working.' };
  } catch (error) {
    rethrowControlFlow(error);
    console.error('[grantfinderstudio] the share could not be withdrawn:', error);
    return {
      ...EMPTY_SHARE,
      message: 'We could not withdraw that link. It is still live — please try again.',
    };
  }
}

/**
 * Mark a reviewer's comment as dealt with, or put it back.
 *
 * Not a delete. What a reviewer said is worth keeping once it has been
 * answered — it is the record of why an answer changed — so "handled" is a
 * state and the words stay.
 *
 * The reviewer's name and the question number for the trail are read from the
 * row rather than taken from the form. They are on the screen the form was
 * posted from, so trusting them would only ever let the applicant write a
 * wrong name into their own audit trail, which is a small fault and an
 * avoidable one.
 */
export async function setCommentHandledAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const organisationId = await requireOrganisationId();
  const userId = await requireUserId();
  const applicationId = String(formData.get('applicationId') ?? '');
  const commentId = String(formData.get('commentId') ?? '');
  // The state being asked for, so the button is idempotent: pressing it twice
  // does not toggle back and forth with the screen a step behind.
  const handled = String(formData.get('handled') ?? '') === '1';
  if (applicationId === '' || commentId === '') {
    return { ...EMPTY_EDIT, message: 'Nothing to mark.' };
  }

  const database = await getDatabase();
  try {
    const outcome = await database.withTenant(organisationId, async (tx) => {
      const comment = (await loadComments(tx, applicationId)).find(
        (row) => row.id === commentId,
      );
      if (comment === undefined) return null;
      const changed = await setCommentHandled(
        tx,
        applicationId,
        commentId,
        handled ? { by: userId } : null,
      );
      if (changed) {
        await recordAudit(tx, organisationId, {
          userId,
          action: handled ? 'comment.handled' : 'comment.reopened',
          entityId: commentId,
          applicationId,
          metadata: {
            reviewerName: comment.reviewerName,
            questionNumber:
              comment.questionId === null
                ? null
                : await questionNumber(tx, applicationId, comment.questionId),
          },
        });
      }
      return changed;
    });

    revalidatePath(`/applications/${applicationId}`);
    if (outcome === null) return { ...EMPTY_EDIT, message: 'That comment has gone.' };
    return outcome
      ? { ok: true, message: handled ? 'Marked as dealt with.' : 'Put back on the list.' }
      : { ...EMPTY_EDIT, message: 'That was already how it was.' };
  } catch (error) {
    rethrowControlFlow(error);
    console.error('[grantfinderstudio] the comment could not be marked:', error);
    return { ...EMPTY_EDIT, message: 'We could not mark that. Nothing has changed.' };
  }
}
