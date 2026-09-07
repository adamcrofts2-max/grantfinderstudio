'use server';

import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db';
import { addQuestions, loadApplication, loadFacts, saveAnswer, type NewQuestion } from '@/db/workspace';
import { usableFacts } from '@/domain/provenance/facts';
import { providerFromStore } from '@/ai/provider-from-store';
import { runAgent } from '@/ai/run';
import { buildWriterPrompt, checkDraft, WRITER } from '@/ai/agents/writer';
import { DEMO_ORG_ID, DEMO_USER_ID } from '@/demo/seed';
import { EMPTY_DRAFT, type AddState, type DraftState } from './state';

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
  const prepared = await database.withTenant(DEMO_ORG_ID, async (tx) => {
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

  await database.withTenant(DEMO_ORG_ID, async (tx) => {
    await saveAnswer(
      tx,
      DEMO_ORG_ID,
      {
        questionId,
        content: checked.text,
        wordCount: checked.wordCount,
        claims: sentences.map((s) => ({ text: s.text, factId: s.factId })),
      },
      DEMO_USER_ID,
    );
  });

  revalidatePath(`/applications/${applicationId}`);

  const notes: string[] = [];
  const over = checked.issues.find((issue) => issue.kind === 'over_word_limit');
  if (over) notes.push(over.detail);
  const repeated = checked.issues.filter((issue) => issue.kind === 'repeated_fact');
  if (repeated.length > 0) {
    notes.push(`${repeated.length} fact${repeated.length === 1 ? ' is' : 's are'} stated more than once.`);
  }
  if (checked.unsupported.length > 0) {
    notes.push(
      `${checked.unsupported.length} sentence${checked.unsupported.length === 1 ? '' : 's'} could not be supported and ${checked.unsupported.length === 1 ? 'is' : 'are'} marked below.`,
    );
  }

  return {
    questionId,
    ok: true,
    message:
      notes.length === 0
        ? `Drafted ${checked.wordCount} words, every claim traced to a confirmed fact.`
        : `Drafted ${checked.wordCount} words. ${notes.join(' ')}`,
    claims: sentences.map((s) => ({
      text: s.text,
      factId: s.factId,
      factLabel: s.factId === null ? null : (byId.get(s.factId)?.claim ?? null),
    })),
    gaps: checked.gaps,
    wordCount: checked.wordCount,
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
  await database.withTenant(DEMO_ORG_ID, (tx) =>
    addQuestions(tx, DEMO_ORG_ID, applicationId, questions),
  );

  revalidatePath(`/applications/${applicationId}`);
  return {
    ok: true,
    message: `Added ${questions.length} question${questions.length === 1 ? '' : 's'}.`,
  };
}
