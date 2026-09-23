import { Lost } from '@/app/illustration/cast';

/**
 * A page that is not here.
 *
 * Also what a fund, an application or a review link answers with when it is
 * not yours to see — deliberately the same page, so it says nothing about
 * whether the thing exists. So the words do not accuse anybody of a typo:
 * the link may be old, withdrawn, or somebody else's.
 */
export default function NotFound() {
  return (
    <div className="page page-narrow">
      <section className="card lost">
        <div className="lost-figure">
          <Lost />
        </div>
        <h1 className="page-title">This page is not on the map</h1>
        <p className="page-sub">
          The link may be old, the thing it pointed at may have been removed, or it may belong
          to another organisation. Nothing here has been changed.
        </p>
        <p style={{ marginTop: 'var(--s-5)' }}>
          <a className="btn btn-primary" href="/">
            Back to the start
          </a>
        </p>
      </section>
    </div>
  );
}
