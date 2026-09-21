import { auditDetail, auditLabel } from '@/domain/audit/actions';
import type { AuditRow } from '@/db/audit';

/**
 * What has happened to this application, newest first.
 *
 * ## Why this screen exists
 *
 * Because `audit_logs` was written and nothing read it, which is the same
 * fault as a table nothing writes to — one step further along. A record
 * nobody can see is not a record, it is a cost.
 *
 * It answers two questions. "Who changed this, and when" is a fair one in an
 * organisation with more than one person in it, and until now the only answer
 * was the answer itself. And it is the surface Phase 9 Step 2 needs: a
 * reviewer given one application read-only is entitled to see what has been
 * done to the thing they are reading, and the applicant is entitled to see
 * that the reviewer read it.
 *
 * ## Folded away
 *
 * It is a reference, not a task. The application page is a place to write, and
 * a forty-line history above the answer boxes would be the page telling you
 * about itself instead of letting you work.
 *
 * ## "You" and "a colleague"
 *
 * Not a name. `app_user` cannot read the `users` table at all — 0009 took that
 * away deliberately — so a tenant page cannot join a user id to a person. The
 * session knows who is reading, which is enough to say whether a line is
 * theirs, and that is the distinction that actually matters on the screen.
 * Rendering the raw id would be worse than saying nothing.
 */
export function TrailPanel({
  trail,
  viewerId,
  whenByRow,
}: {
  trail: readonly AuditRow[];
  viewerId: string;
  /**
   * How long ago each line was, by row id, phrased by the SERVER.
   *
   * Not computed here from `Date.now()`. That is what `ReviewPanel` did, and
   * a clock read while rendering gives one answer in the server's HTML and
   * another on hydration — React #418, and the tree thrown away. This
   * component is a server component and could read the clock safely, but
   * taking the phrases as a prop keeps the rule the same everywhere: one
   * clock reading, in the page that loaded the rows.
   */
  whenByRow: Readonly<Record<string, string>>;
}) {
  if (trail.length === 0) return null;

  /**
   * The actor is shown only when it distinguishes something.
   *
   * The first screenshot of this panel was five lines each ending "by you",
   * which is the page telling a sole director who they are. Worth saying when
   * a colleague has been in here, worth nothing when nobody has — so it
   * appears when the trail has more than one actor in it, and not otherwise.
   */
  const actors = new Set(trail.map((row) => row.userId));
  const showActor = actors.size > 1 || !actors.has(viewerId);

  /**
   * Who did it, in the two or three words the line has room for.
   *
   * A null user id normally means the system acted unprompted — which is why
   * it read "automatically", and why a REVIEWER's read read "automatically"
   * too. It is not: it is a named outsider the applicant let in, and the
   * whole point of recording it is that somebody did it. A reviewer is not a
   * user of this organisation, so the id stays null and the sentence changes
   * instead.
   */
  const actorOf = (row: AuditRow): string => {
    if (row.userId === viewerId) return 'by you';
    if (row.userId !== null) return 'by a colleague';
    return row.action === 'share.viewed' ? 'by your reviewer' : 'automatically';
  };

  return (
    <details className="card paste">
      <summary className="paste-summary">
        What has happened here
        <span className="chev chev-toggle" />
      </summary>
      <div className="paste-body">
        <p className="card-sub" style={{ marginBottom: 'var(--s-4)' }}>
          Every change to this application, newest first. Kept so that you — or
          anyone you show it to — can see how it got to where it is.
        </p>
        <ol className="trail">
          {trail.map((row) => {
            const detail = auditDetail(row.action, row.metadata);
            return (
              <li className="trail-line" key={row.id}>
                <span className="trail-what">{auditLabel(row.action)}</span>
                <span className="trail-when">{whenByRow[row.id] ?? 'earlier'}</span>
                {showActor ? <span className="trail-who">{actorOf(row)}</span> : null}
                {detail === '' ? null : <span className="trail-detail">{detail}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}
