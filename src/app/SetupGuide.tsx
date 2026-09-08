import type { SetupProgress, SetupStep } from '@/domain/setup/progress';

/**
 * One thing to do, and what comes after it.
 *
 * Someone who has never applied for funding does not want five tasks and nine
 * menu items; they want to know what to do now. So the next step is the whole
 * card, the rest is folded away, and the navigation stays out of the way until
 * they have finished (see the layout).
 *
 * It removes itself once everything is done — a checklist that outstays its
 * usefulness is nagging.
 */
export function SetupGuide({ progress }: { progress: SetupProgress }) {
  const next = progress.next;
  if (progress.complete || next === null) return null;

  const position = progress.steps.findIndex((step) => step.id === next.id);
  const after = progress.steps[position + 1] ?? null;

  return (
    <section className="card setup" aria-labelledby="setup-heading">
      <p className="eyebrow setup-position">
        Step {position + 1} of {progress.total}
      </p>
      <h2 className="setup-hero" id="setup-heading">
        {next.title}
      </h2>
      <p className="setup-why">{next.why}</p>

      {next.blocked === null ? null : (
        <p className="notice notice-caution">
          <span aria-hidden="true">⚠</span>
          <span>{next.blocked}</span>
        </p>
      )}

      <a className="btn btn-primary setup-go" href={next.href}>
        {next.action}
      </a>

      {after === null ? null : (
        <p className="setup-after">
          <span className="setup-after-label">Then</span> {after.title.toLowerCase()}
        </p>
      )}

      <details className="setup-all">
        <summary>See all {progress.total} steps</summary>
        <ol className="setup-steps">
          {progress.steps.map((step, index) => (
            <SmallStep
              key={step.id}
              step={step}
              index={index}
              isNext={step.id === next.id}
            />
          ))}
        </ol>
      </details>
    </section>
  );
}

function SmallStep({
  step,
  index,
  isNext,
}: {
  step: SetupStep;
  index: number;
  isNext: boolean;
}) {
  const state = step.done ? 'is-done' : isNext ? 'is-next' : '';
  return (
    <li className={`setup-step ${state}`.trim()}>
      <span className="setup-mark" aria-hidden="true">
        {step.done ? '✓' : index + 1}
      </span>
      <span className="setup-step-title">
        {step.done ? step.title : <a href={step.href}>{step.title}</a>}
        {step.done ? <span className="setup-done-label"> · done</span> : null}
      </span>
    </li>
  );
}
