'use server';

import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { addQuestions, loadApplication, loadFacts, saveAnswer, type NewQuestion } from '@/db/workspace';
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
  EMPTY_REVIEW,
  EMPTY_WRITE,
  type AddState,
  type DraftState,
  type ReviewState,
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

  await database.withTenant(organisationId, (tx) =>
    saveAnswer(
      tx,
      organisationId,
      // No claims: see the provenance rule above. This deletes the refs from
      // any previous draft, which is the point rather than a side effect.
      { questionId, content, wordCount, claims: [] },
      userId,
    ),
  );

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
  await database.withTenant(organisationId, (tx) =>
    addQuestions(tx, organisationId, applicationId, questions),
  );

  revalidatePath(`/applications/${applicationId}`);
  return {
    ok: true,
    message: `Added ${questions.length} question${questions.length === 1 ? '' : 's'}.`,
  };
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
  const applicationId = String(formData.get('applicationId') ?? '');
  const mode = formData.get('mode') === 'red_team' ? 'red_team' : 'standard';
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

    return {
      ok: true,
      message:
        checked.findings.length === 0
          ? 'Nothing found. That is worth a second read by a person before you rely on it.'
          : `${checked.findings.length} ${checked.findings.length === 1 ? 'thing' : 'things'} to look at.`,
      mode,
      findings: [...checked.findings].toSorted(bySeverity),
      mostImportant: checked.mostImportant,
      strengths: checked.strengths,
      injected: checked.instructionLikeContent,
      discarded: result.output.findings.length - checked.findings.length,
    };
  } catch {
    return { ...EMPTY_REVIEW, ok: false, message: 'The review could not be completed. Nothing has changed.' };
  }
}
