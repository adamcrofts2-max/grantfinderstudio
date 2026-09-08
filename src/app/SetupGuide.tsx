import type { SetupProgress } from '@/domain/setup/progress';

/**
 * The path through the product, for an organisation that has not finished
 * setting up.
 *
 * Shown on the home page, which is otherwise an empty list for a new account —
 * and an empty list with no route out of it is where people leave. It
 * disappears on its own once every step is done, because a checklist that
 * stays after it is finished is nagging.
 *
 * Each step says WHY it matters rather than what it does. "Confirm your facts"
 * means nothing; "below five the Writer will not draft at all" is a reason.
 */
export function SetupGuide({ progress }: { progress: SetupProgress }) {
  if (progress.complete) return null;
  const pct = Math.round((progress.done / progress.total) * 100);

  return (
    <section className="card setup" aria-labelledby="setup-heading">
      <div className="row-between" style={{ alignItems: 'center' }}>
        <div>
          <h2 className="card-title" id="setup-heading">
            Getting set up
          </h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
            {progress.done} of {progress.total} done. Nothing here is locked — you can jump
            ahead and come back.
          </p>
        </div>
        <span className="setup-count" aria-hidden="true">
          {progress.done}/{progress.total}
        </span>
      </div>

      <div
        className="setup-bar"
        role="img"
        aria-label={`${progress.done} of ${progress.total} steps done`}
      >
        <div className="setup-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      <ol className="setup-steps">
        {progress.steps.map((step, index) => {
          const isNext = step.id === progress.next?.id;
          return (
            <li
              key={step.id}
              className={step.done ? 'setup-step is-done' : isNext ? 'setup-step is-next' : 'setup-step'}
            >
              <span className="setup-mark" aria-hidden="true">
                {step.done ? '✓' : index + 1}
              </span>
              <div className="setup-body">
                <h3 className="setup-title">
                  {step.title}
                  {step.done ? <span className="setup-done-label"> · done</span> : null}
                </h3>
                {step.done ? null : <p className="setup-why">{step.why}</p>}
                {step.blocked === null ? null : (
                  <p className="notice notice-caution setup-blocked">
                    <span aria-hidden="true">⚠</span>
                    <span>{step.blocked}</span>
                  </p>
                )}
                {step.done ? null : (
                  <a
                    className={isNext ? 'btn btn-primary' : 'btn btn-secondary'}
                    href={step.href}
                  >
                    {step.action}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
