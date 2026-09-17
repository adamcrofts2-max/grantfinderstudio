import { gbp } from '@/app/components';
import type { RecipientSummary } from '@/db/grants';

/**
 * The matching grants, as the organisations that received them.
 *
 * ## Why this view exists
 *
 * Asked for: "be able to search via similar CICs and see the past grants
 * they've been awarded." It is the strongest form of the question this screen
 * is titled after. A funder's grant list tells you what that funder likes; a
 * PEER'S funder list is a plan — "this food-bank CIC raised £60,000 from three
 * trusts, and here they are" names the next three approaches to make.
 *
 * ## What is NOT claimed
 *
 * Not that these organisations are like yours. We hold a name, the regions
 * their grants went to, the labels on them and the amounts — no sector, no
 * size, no legal form. So the heading states the condition instead of
 * assuming it: these are the bodies funded for the work you searched for, and
 * whether that is your work is something only you know. A list headed
 * "organisations like yours" that was really "whoever turned up" would be the
 * same overclaim the count on this page has already been through twice.
 */

function year(date: string | null): string {
  return date === null ? '—' : date.slice(0, 4);
}

/**
 * How their typical grant compares with the ask, in the words the ordering is
 * made of — so the reader can check the sort rather than trust it.
 */
const SIZE: Record<0 | 1 | 2, string> = {
  0: 'about your size',
  1: 'a different scale to your ask',
  2: 'nothing like your ask',
};

function Row({ recipient, region }: { recipient: RecipientSummary; region: string | null }) {
  const {
    name, matching, totalGbp, largestGbp, medianGbp, funders, funderNames,
    regions, firstAwardedOn, lastAwardedOn, commonTag, inYourRegion, sizeBand,
  } = recipient;
  const more = funders - funderNames.length;

  return (
    <li className="funder-card peer">
      <div className="row-between">
        <div>
          <p className="funder-name">{name}</p>
          <p className="funder-why">
            {gbp(totalGbp)} across {matching} grant{matching === 1 ? '' : 's'}
            {' · '}
            {funders === 1 ? 'one funder' : `${funders} funders`}
            {/* Their area before the label: whether a peer is local is the
                part an applicant reads first, and it is one of the keys the
                ordering uses. */}
            {region !== null && inYourRegion > 0
              ? ` · ${inYourRegion === matching ? `all in ${region}` : `${inYourRegion} in ${region}`}`
              : regions.length === 0
                ? ''
                : ` · ${regions.slice(0, 2).join(', ')}`}
            {commonTag === null ? '' : ` · ${commonTag}`}
            {sizeBand === null ? '' : ` · ${SIZE[sizeBand]}`}
          </p>
        </div>
        <p className="peer-figure">
          {/* The median rather than the mean, and only alongside the count, so
              nobody reads a typical figure off two grants. */}
          {matching === 1 ? gbp(largestGbp) : `typically ${gbp(medianGbp)}`}
        </p>
      </div>

      <p className="funder-why" style={{ marginTop: 'var(--s-2)' }}>
        {/* The names are the actionable part — this is the list of funders who
            have backed a body doing this kind of work. */}
        Funded by {funderNames.join(', ')}
        {more > 0 ? ` and ${more} other${more === 1 ? '' : 's'}` : ''}
        {firstAwardedOn === null ? '' : ` · ${year(firstAwardedOn)}`}
        {lastAwardedOn === null || year(lastAwardedOn) === year(firstAwardedOn)
          ? ''
          : `–${year(lastAwardedOn)}`}
        {largestGbp === medianGbp ? '' : ` · largest ${gbp(largestGbp)}`}
      </p>
    </li>
  );
}

export function RecipientList({
  recipients,
  region,
}: {
  recipients: readonly RecipientSummary[];
  region: string | null;
}) {
  if (recipients.length === 0) return null;
  const local = recipients.filter((r) => r.inYourRegion > 0).length;

  return (
    <>
      <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
        The organisations that received these grants, and who funded them. If your search
        describes your own work, these are the bodies most like yours that have been paid for
        it — and their funders are the ones to look at next.
        {/* Said, rather than left to be noticed. A list of six counties none
            of which is yours reads as a search fault; "none of these is in
            Somerset" is a fact about the record. */}
        {region === null
          ? ''
          : local === 0
            ? ` None of them is in ${region} — nobody there has been funded for this yet.`
            : ` ${local} of them ${local === 1 ? 'is' : 'are'} in ${region}.`}
      </p>
      <ul className="funders-grouped">
        {recipients.map((recipient) => (
          <Row key={recipient.key} recipient={recipient} region={region} />
        ))}
      </ul>
    </>
  );
}
