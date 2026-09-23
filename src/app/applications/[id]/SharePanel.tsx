'use client';

import { useActionState } from 'react';

import { createShareAction, revokeShareAction } from './actions';
import { EMPTY_SHARE } from './state';
import { CopyButton } from './CopyButton';
import { SHARE_LENGTHS, type ShareStanding } from '@/domain/review/share';

/**
 * Letting somebody outside the organisation read one application.
 *
 * ## Why this is a panel and not a switch
 *
 * A reviewer reading a CIC's application is reading its finances, its
 * beneficiaries and whatever its facts say about the people who run it. That
 * is a processor relationship whichever way it is dressed up, so the screen
 * asks who, for how long, and shows every link ever made along with what it
 * has been used for. A toggle marked "public link" would be the same
 * disclosure with none of the record.
 *
 * ## Why the link appears exactly once
 *
 * Only the token's SHA-256 is stored, so there is nothing to show a second
 * time. That is deliberate — a copy of the table is not a set of working
 * links — and the consequence is that a link not copied off this response has
 * to be replaced rather than recovered. The panel says so rather than leaving
 * somebody hunting for it.
 *
 * ## Why every relative time arrives as a phrase
 *
 * This is a client component, and a clock read during render gives one answer
 * in the server's HTML and another on hydration — React #418, and the tree
 * thrown away. The page reads the clock once and phrases these there.
 */
export interface ShareView {
  id: string;
  reviewerName: string;
  standing: ShareStanding;
  /** Whole days, rounded up. Only meaningful while it is live. */
  daysLeft: number;
  views: number;
  /** Phrased by the page, e.g. "3 days ago". Null when never opened. */
  firstViewed: string | null;
  lastViewed: string | null;
  created: string;
}

const STANDING: Record<ShareStanding, { label: string; className: string }> = {
  live: { label: 'Live', className: 'badge badge-positive' },
  expired: { label: 'Expired', className: 'badge badge-neutral' },
  revoked: { label: 'Withdrawn', className: 'badge badge-neutral' },
};

export function SharePanel({
  applicationId,
  answered,
  shares,
}: {
  applicationId: string;
  /** How many questions have an answer. Nothing to review before there is one. */
  answered: number;
  shares: readonly ShareView[];
}) {
  const [created, create, creating] = useActionState(createShareAction, EMPTY_SHARE);
  const [revoked, revoke] = useActionState(revokeShareAction, EMPTY_SHARE);
  const result = created.message !== '' ? created : revoked.message !== '' ? revoked : null;
  const live = shares.filter((share) => share.standing === 'live');

  return (
    <details className="card paste" id="share" open={created.link !== null}>
      <summary className="paste-summary">
        Have somebody read it
        {live.length > 0 ? (
          <span className="badge badge-positive" style={{ marginLeft: 'var(--s-2)' }}>
            {live.length} live link{live.length === 1 ? '' : 's'}
          </span>
        ) : null}
        <span className="chev chev-toggle" />
      </summary>
      <div className="paste-body">
        <p className="card-sub">
          A read-only link to this application — the answers, the evidence behind every
          claim, and what the funder’s rules say. They need no account and can change
          nothing. You can withdraw it at any time, and you will see when they read it.
        </p>

        {/* THE LINK, once.
            Shown above everything else while it is on screen: it cannot be
            recovered, so it must not be something to scroll for. */}
        {created.link !== null ? (
          <div className="notice notice-neutral" style={{ marginTop: 'var(--s-4)' }}>
            <span aria-hidden="true">⎘</span>
            <span>
              <strong>Copy this now — we cannot show it again.</strong> Only a fingerprint
              of the link is stored, so a lost one has to be replaced rather than found.
              <span className="sharelink">{created.link}</span>
              <CopyButton label="Copy the link" text={created.link} variant="primary" />
            </span>
          </div>
        ) : null}

        {/* A HEADING over the list, and another over the form.
            Without them the row sat between the copy notice and the "Who is
            it for" field with nothing to say which was a record and which was
            a control — one screenshot of a single-row list was enough to show
            it reading as part of the form above it. */}
        {shares.length > 0 ? (
          <h3 className="part-head">
            {shares.length === 1 ? 'The link you have made' : 'The links you have made'}
          </h3>
        ) : null}
        {shares.length > 0 ? (
          <ul className="shares" style={{ marginTop: 'var(--s-3)' }}>
            {shares.map((share) => (
              <li className="share" key={share.id}>
                <span className="share-who">{share.reviewerName}</span>
                <span className={STANDING[share.standing].className}>
                  {STANDING[share.standing].label}
                </span>
                <span className="share-when">
                  {share.standing === 'live'
                    ? `${share.daysLeft} day${share.daysLeft === 1 ? '' : 's'} left`
                    : `shared ${share.created}`}
                </span>
                <span className="share-reads">
                  {share.views === 0
                    ? 'Not opened yet'
                    : share.views === 1
                      ? `Opened once, ${share.lastViewed ?? 'earlier'}`
                      : `Opened ${share.views} times, last ${share.lastViewed ?? 'earlier'}`}
                </span>
                {share.standing === 'live' ? (
                  <form action={revoke}>
                    <input name="applicationId" type="hidden" value={applicationId} />
                    <input name="shareId" type="hidden" value={share.id} />
                    <input name="reviewerName" type="hidden" value={share.reviewerName} />
                    <button className="btn btn-quiet" type="submit">
                      Withdraw
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {answered === 0 ? (
          <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
            There is nothing to read yet — answer a question first, and the link will show
            it.
          </p>
        ) : null}

        <form action={create} style={{ marginTop: 'var(--s-5)' }}>
          <input name="applicationId" type="hidden" value={applicationId} />
          <h3 className="card-title" style={{ fontSize: 'var(--t-md)' }}>
            {shares.length === 0 ? 'Make a review link' : 'Make another link'}
          </h3>
          <div className="field-row" style={{ marginTop: 'var(--s-3)' }}>
            <div className="field">
              <label className="label" htmlFor="share-who">
                Who is it for
              </label>
              <input
                aria-invalid={!created.ok && created.field === 'reviewerName'}
                className="input"
                id="share-who"
                name="reviewerName"
                placeholder="e.g. Jan, our treasurer"
                type="text"
              />
              <p className="hint">
                Your own label, so you can tell your links apart and know whose access you
                are withdrawing. We do not email it to them — that is for you to do.
              </p>
            </div>
            <div className="field">
              <label className="label" htmlFor="share-days">
                For how long
              </label>
              <select className="input" defaultValue={14} id="share-days" name="days">
                {SHARE_LENGTHS.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
              <p className="hint">There is no “never expires”, on purpose.</p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            {/* Not "Make a review link" — the heading above the form says
                that already, and a button repeating its own heading reads as
                a second, different action. */}
            <button className="btn btn-primary" disabled={creating} type="submit">
              {creating ? 'Making the link…' : 'Make the link'}
            </button>
          </div>
        </form>

        <div aria-live="polite">
          {result !== null && result.link === null ? (
            <p
              className={`notice ${result.ok ? 'notice-neutral' : 'notice-caution'}`}
              style={{
                marginTop: 'var(--s-3)',
                color: result.ok ? 'var(--positive)' : undefined,
                fontWeight: 550,
              }}
            >
              <span aria-hidden="true">{result.ok ? '✓' : '⚠'}</span>
              <span>{result.message}</span>
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
