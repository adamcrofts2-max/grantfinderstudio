/**
 * A realistic 360Giving publisher, for walking the product against.
 *
 * ## Why this is in the repository
 *
 * Because the version that was not got rebuilt from memory every session, and
 * twice it was quietly degenerate in ways that made the search look better
 * than it was:
 *
 *   - A seed keyed on `orgId.length` — the same for every funder — gave 471
 *     grants holding fifteen distinct ones.
 *   - `pick(array, i * k)` with `k` sharing a factor with `array.length`
 *     reached 3 of 15 recipients and 3 of 9 amount bands.
 *
 * A ranking measured on a degenerate corpus always looks correct. So the
 * generator here draws every field from its own stream of a per-grant seed
 * (FNV-1a over the funder id and the index — never a length), and
 * `--print` reports the distribution so that degeneracy is visible rather
 * than inferred.
 *
 * ## What it is not
 *
 * It is not real data and it is not a fixture for assertions — `npm run e2e`
 * carries its own tiny stub for that, where five grants with known text are
 * what makes a failure legible. This one exists so that a human walking the
 * product sees something like what a person sees: hundreds of grants, dozens
 * of funders and recipients, several organisations that look like the one
 * they are, and prose with enough variety that relevance has work to do.
 *
 * Every name is invented. Amounts, dates and places are plausible rather than
 * accurate, and nothing here should ever be shown to a customer as fact —
 * which is why the dataset it declares says so in its own attribution.
 *
 *   node scripts/stub-360giving.mjs            # serve on 4599
 *   node scripts/stub-360giving.mjs --port 4610
 *   node scripts/stub-360giving.mjs --slow 400 # a load slow enough to watch
 *   node scripts/stub-360giving.mjs --print    # the corpus, as statistics
 *
 * Then point the product at it:
 *
 *   THREESIXTYGIVING_BASE_URL=http://127.0.0.1:4599/api/v1/ npm start
 */

import { createServer } from 'node:http';

/* ------------------------------------------------------------------ *
 * Randomness that is the same every run, and independent per field.
 * ------------------------------------------------------------------ */

/** FNV-1a. A hash of the whole string, so two funders never share a seed. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough that fields do not correlate. */
function stream(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const between = (rng, low, high) => low + rng() * (high - low);

/* ------------------------------------------------------------------ *
 * The work being funded. Themes carry prose, not just a label.
 * ------------------------------------------------------------------ */

/**
 * Each theme has several titles and several descriptions, because a corpus
 * where every grant of a kind reads identically cannot tell a good ranking
 * from a bad one — every result is equally close to every query.
 */
const THEMES = {
  tree_nursery: {
    label: 'Environment',
    titles: [
      'Community tree nursery',
      'Village tree nursery and seed bank',
      'Growing local trees from local seed',
      'Tree nursery expansion',
      'Native sapling nursery',
    ],
    descriptions: [
      'Establishing a community tree nursery growing native saplings from locally collected seed, with volunteer propagation days and free trees for parish planting schemes.',
      'Funding polytunnels, irrigation and a part-time nursery coordinator so the group can grow 12,000 native trees of local provenance each year.',
      'Seed collection, stratification and growing-on of oak, hazel, field maple and hawthorn for hedgerow and woodland planting within twenty miles of the nursery.',
      'A volunteer-run nursery supplying trees to schools, farms and community woodland projects, with propagation training for thirty new volunteers.',
    ],
  },
  community_woodland: {
    label: 'Environment',
    titles: [
      'Community woodland creation',
      'Woodland management and access',
      'Bringing the village wood back into management',
      'New community woodland',
    ],
    descriptions: [
      'Planting eleven hectares of new broadleaf woodland on former pasture, with public access paths, a volunteer coppice group and five years of establishment maintenance.',
      'Returning a neglected hazel and ash wood to rotational coppice, with tools, training, deer fencing and a woodland management plan.',
      'Community purchase and management of woodland, opening it for the first time to local walkers, forest school and volunteer work parties.',
    ],
  },
  orchard: {
    label: 'Environment',
    titles: [
      'Community orchard restoration',
      'Traditional orchard planting',
      'Orchard and grafting project',
    ],
    descriptions: [
      'Restoring a derelict traditional orchard with pruning, replacement standard trees on local varieties, and annual apple day for the village.',
      'Planting a new community orchard on unused parish land, with grafting workshops and a scion bank of West Country cider and cooking varieties.',
    ],
  },
  hedgerow: {
    label: 'Environment',
    titles: ['Hedgerow restoration', 'Hedge laying and planting', 'Linking woodlands with hedges'],
    descriptions: [
      'Planting 2.4km of new hedgerow and laying 900m of derelict hedge, with a volunteer hedge-laying group and training from a regional craftsman.',
      'Restoring hedgerows as wildlife corridors between two woodlands, including gapping up, tree guards and three years of maintenance.',
    ],
  },
  forest_school: {
    label: 'Children and young people',
    titles: ['Forest school sessions', 'Outdoor learning in the woods', 'Forest school for local schools'],
    descriptions: [
      'Weekly forest school sessions for four primary schools in the most deprived wards of the district, with a qualified leader and all-weather kit.',
      'Outdoor learning for children with additional needs, in a managed woodland, with transport so that cost is not the barrier.',
    ],
  },
  green_skills: {
    label: 'Employment and training',
    titles: [
      'Green skills traineeships',
      'Woodland skills training',
      'Routes into land-based work',
      'Countryside skills for young people',
    ],
    descriptions: [
      'Twelve paid traineeships in woodland management and tree care for 18 to 24 year olds not in work or education, with chainsaw, first aid and arboriculture tickets.',
      'Practical training and volunteering in woodland crafts for young people, leading to a Level 2 qualification and supported job applications.',
      'Green skills bootcamps for adults changing career into land management, run with a further education college.',
    ],
  },
  rewilding: {
    label: 'Environment',
    titles: ['River catchment restoration', 'Wetland and scrub creation', 'Nature recovery on the levels'],
    descriptions: [
      'Restoring a degraded river catchment with leaky dams, bankside tree planting and a volunteer river monitoring group.',
      'Creating wetland and scrub mosaic on twenty hectares of marginal farmland, with community wildlife surveys.',
    ],
  },
  urban_greening: {
    label: 'Environment',
    titles: ['Street trees and pocket parks', 'Greening the estate', 'Urban canopy project'],
    descriptions: [
      'Planting 240 street trees and three pocket parks on a housing estate with almost no canopy cover, with resident tree wardens watering through the first summers.',
      'Turning disused verges and car parks into planted community space, chosen and maintained by the people who live there.',
    ],
  },
  nature_wellbeing: {
    label: 'Mental health',
    titles: ['Green social prescribing', 'Nature and wellbeing groups', 'Woodland wellbeing sessions'],
    descriptions: [
      'Green social prescribing for adults with anxiety and depression, referred by three GP surgeries, based on practical conservation work in woodland.',
      'Weekly nature-based wellbeing groups for people recovering from long-term illness, with travel costs covered.',
    ],
  },
  youth_skills: {
    label: 'Children and young people',
    titles: ['Youth skills programme', 'Evening skills sessions', 'Youth club and training'],
    descriptions: [
      'Practical training and volunteering for 14 to 19 year olds in a rural town with no youth provision since 2019.',
      'Evening skills sessions and accredited training for young people at risk of exclusion, with a detached youth worker.',
    ],
  },
  food: {
    label: 'Food and poverty',
    titles: ['Community food hub', 'Growing and cooking together', 'Food club and kitchen'],
    descriptions: [
      'A community food hub redistributing surplus and running cooking sessions, with a paid coordinator and a van.',
      'Market garden and cooking project supplying a pay-what-you-can food club on a rural estate.',
    ],
  },
  heritage: {
    label: 'Heritage',
    titles: ['Chapel roof repair', 'Village hall restoration', 'Saving the old mill'],
    descriptions: [
      'Urgent repairs to the roof of a grade II listed chapel, keeping the building in community use.',
      'Restoration of a village hall including rewiring, insulation and a new accessible entrance.',
    ],
  },
};

const THEME_IDS = Object.keys(THEMES);

/* ------------------------------------------------------------------ *
 * Who received the money. The point of the peer view.
 * ------------------------------------------------------------------ */

/**
 * Recipients, with the themes they work on and where they are.
 *
 * Deliberately includes a cluster of organisations that a community tree
 * nursery would recognise as its own kind, each funded several times by
 * several funders — because "who like us has been funded, and by whom" is the
 * question the product exists to answer, and it cannot be walked against a
 * corpus where every recipient appears once.
 *
 * The legal suffixes vary (CIC, C.I.C., Limited, none) on purpose:
 * `recipientSummaries` normalises them away, and a corpus where they are all
 * spelled the same never tests that.
 */
const RECIPIENTS = [
  // The peer cluster: tree and woodland CICs.
  { id: 'GB-COH-14100201', name: 'Rooted Community Trees CIC', region: 'Somerset', themes: ['tree_nursery', 'community_woodland', 'hedgerow'] },
  { id: 'GB-COH-14100202', name: 'Wyre Vale Tree Nursery C.I.C.', region: 'Gloucestershire', themes: ['tree_nursery', 'green_skills'] },
  { id: 'GB-COH-14100203', name: 'Blackdown Woodland Collective CIC', region: 'Somerset', themes: ['community_woodland', 'forest_school', 'tree_nursery'] },
  { id: 'GB-COH-14100204', name: 'Teign Trees and Hedges CIC', region: 'Devon', themes: ['hedgerow', 'tree_nursery'] },
  { id: 'GB-COH-14100205', name: 'Sowing Roots Community Interest Company', region: 'Dorset', themes: ['tree_nursery', 'orchard'] },
  { id: 'GB-COH-14100206', name: 'Quantock Community Woodland CIC', region: 'Somerset', themes: ['community_woodland', 'green_skills'] },
  { id: 'GB-COH-14100207', name: 'Avon Urban Forest CIC', region: 'Bristol', themes: ['urban_greening', 'tree_nursery'] },
  { id: 'GB-COH-14100208', name: 'Cornish Native Trees Limited', region: 'Cornwall', themes: ['tree_nursery', 'community_woodland'] },
  // Nature and land, adjacent but not the same work.
  { id: 'GB-CHC-1141001', name: 'Tone Valley Rivers Trust', region: 'Somerset', themes: ['rewilding', 'hedgerow'] },
  { id: 'GB-CHC-1141002', name: 'Levels and Moors Nature Partnership', region: 'Somerset', themes: ['rewilding'] },
  { id: 'GB-COH-14100209', name: 'Wild Exmoor CIC', region: 'Devon', themes: ['rewilding', 'nature_wellbeing'] },
  { id: 'GB-CHC-1141003', name: 'Mendip Orchards Group', region: 'Somerset', themes: ['orchard'] },
  { id: 'GB-COH-14100210', name: 'Green Futures Training CIC', region: 'Devon', themes: ['green_skills', 'youth_skills'] },
  { id: 'GB-COH-14100211', name: 'Outdoor Learning Somerset CIC', region: 'Somerset', themes: ['forest_school', 'nature_wellbeing'] },
  { id: 'GB-CHC-1141004', name: 'Wells Woodland Wellbeing', region: 'Somerset', themes: ['nature_wellbeing', 'community_woodland'] },
  // The rest of a real corpus: everything else a funder funds.
  { id: 'GB-COH-14100212', name: 'Wells Youth Collective', region: 'Somerset', themes: ['youth_skills', 'forest_school'] },
  { id: 'GB-CHC-1141005', name: 'Taunton Food Union', region: 'Somerset', themes: ['food'] },
  { id: 'GB-CHC-1141006', name: 'Bridgwater Community Kitchen', region: 'Somerset', themes: ['food'] },
  { id: 'GB-CHC-1141007', name: 'Friends of St Cuthbert’s Chapel', region: 'Somerset', themes: ['heritage'] },
  { id: 'GB-CHC-1141008', name: 'Cheddar Village Hall Trust', region: 'Somerset', themes: ['heritage'] },
  { id: 'GB-COH-14100213', name: 'Exeter Green Streets CIC', region: 'Devon', themes: ['urban_greening'] },
  { id: 'GB-CHC-1141009', name: 'North Devon Youth Trust', region: 'Devon', themes: ['youth_skills'] },
  { id: 'GB-CHC-1141010', name: 'Plymouth Growing Together', region: 'Devon', themes: ['food', 'urban_greening'] },
  { id: 'GB-CHC-1141011', name: 'Dorset Coast Volunteers', region: 'Dorset', themes: ['rewilding', 'nature_wellbeing'] },
  { id: 'GB-COH-14100214', name: 'Weymouth Skills Works CIC', region: 'Dorset', themes: ['green_skills', 'youth_skills'] },
  { id: 'GB-CHC-1141012', name: 'Bristol Mind and Body', region: 'Bristol', themes: ['nature_wellbeing'] },
  { id: 'GB-CHC-1141013', name: 'Easton Community Garden', region: 'Bristol', themes: ['urban_greening', 'food'] },
  { id: 'GB-CHC-1141014', name: 'Stroud Valleys Heritage', region: 'Gloucestershire', themes: ['heritage', 'orchard'] },
  { id: 'GB-CHC-1141015', name: 'Forest of Dean Young People', region: 'Gloucestershire', themes: ['youth_skills', 'forest_school'] },
  { id: 'GB-CHC-1141016', name: 'Wiltshire Wildlife Volunteers', region: 'Wiltshire', themes: ['rewilding', 'hedgerow'] },
  { id: 'GB-CHC-1141017', name: 'Salisbury Food Partnership', region: 'Wiltshire', themes: ['food'] },
  { id: 'GB-CHC-1141018', name: 'Kernow Young Growers', region: 'Cornwall', themes: ['youth_skills', 'food'] },
  { id: 'GB-CHC-1141019', name: 'Penwith Woodland Group', region: 'Cornwall', themes: ['community_woodland', 'forest_school'] },
];

/* ------------------------------------------------------------------ *
 * Who gave it. Each funder has a character: themes, sizes, places.
 * ------------------------------------------------------------------ */

const FUNDERS = [
  {
    id: 'GB-CHC-1190001',
    name: 'The Wessex Community Fund',
    grants: 64,
    band: [2_000, 30_000],
    themes: ['tree_nursery', 'community_woodland', 'orchard', 'youth_skills', 'food', 'heritage', 'nature_wellbeing'],
    regions: ['Somerset', 'Devon', 'Dorset'],
  },
  {
    id: 'GB-CHC-1190002',
    name: 'Greenwood Trust',
    grants: 58,
    band: [5_000, 60_000],
    themes: ['tree_nursery', 'community_woodland', 'hedgerow', 'orchard', 'green_skills'],
    regions: ['Somerset', 'Devon', 'Dorset', 'Cornwall', 'Gloucestershire'],
  },
  {
    id: 'GB-CHC-1190003',
    name: 'The People’s Communities Fund',
    grants: 96,
    band: [1_000, 250_000],
    themes: THEME_IDS,
    regions: ['Somerset', 'Devon', 'Dorset', 'Cornwall', 'Bristol', 'Gloucestershire', 'Wiltshire'],
  },
  {
    id: 'GB-CHC-1190004',
    name: 'Quantock Hills Trust',
    grants: 34,
    band: [500, 4_000],
    themes: ['tree_nursery', 'orchard', 'hedgerow', 'heritage', 'community_woodland'],
    regions: ['Somerset'],
  },
  {
    id: 'GB-CHC-1190005',
    name: 'The Ashworth Foundation',
    grants: 28,
    band: [60_000, 450_000],
    themes: ['rewilding', 'community_woodland', 'green_skills', 'urban_greening'],
    regions: ['Somerset', 'Devon', 'Bristol', 'Wiltshire'],
  },
  {
    id: 'GB-CHC-1190006',
    name: 'Mendip Heritage Fund',
    grants: 22,
    band: [3_000, 90_000],
    themes: ['heritage', 'orchard'],
    regions: ['Somerset'],
  },
  {
    id: 'GB-CHC-1190007',
    name: 'Southwest Youth Trust',
    grants: 40,
    band: [4_000, 45_000],
    themes: ['youth_skills', 'forest_school', 'green_skills'],
    regions: ['Somerset', 'Devon', 'Cornwall', 'Dorset'],
  },
  {
    id: 'GB-CHC-1190008',
    name: 'Fair Food Alliance',
    grants: 26,
    band: [2_500, 40_000],
    themes: ['food'],
    regions: ['Somerset', 'Devon', 'Bristol', 'Wiltshire'],
  },
  {
    id: 'GB-CHC-1190009',
    name: 'Tarka Rivers Fund',
    grants: 24,
    band: [8_000, 120_000],
    themes: ['rewilding', 'hedgerow', 'tree_nursery'],
    regions: ['Devon', 'Somerset'],
  },
  {
    id: 'GB-CHC-1190010',
    name: 'The Hazel Fund',
    grants: 44,
    band: [500, 5_000],
    themes: ['tree_nursery', 'hedgerow', 'orchard', 'forest_school', 'nature_wellbeing'],
    regions: ['Somerset', 'Devon', 'Dorset', 'Cornwall', 'Bristol', 'Gloucestershire', 'Wiltshire'],
  },
  {
    id: 'GB-CHC-1190011',
    name: 'Bristol City Green Fund',
    grants: 30,
    band: [1_500, 35_000],
    themes: ['urban_greening', 'food', 'nature_wellbeing', 'tree_nursery'],
    regions: ['Bristol'],
  },
  {
    id: 'GB-CHC-1190012',
    name: 'Woodland Skills Levy',
    grants: 20,
    band: [10_000, 150_000],
    themes: ['green_skills', 'community_woodland'],
    regions: ['Somerset', 'Devon', 'Gloucestershire'],
  },
  // A publisher that cannot be read, so the console has a failure to account
  // for and "42 of 42 funders read" cannot quietly mean "we have all of it".
  { id: 'GB-CHC-1190999', name: 'Silent Trust (unreadable)', grants: 0, broken: true },
];

/** Three years back from a fixed date, so a run is reproducible. */
const TODAY = new Date('2026-09-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/**
 * One grant, every field from its own draw.
 *
 * The seed is the funder id AND the index, hashed — not a length, and not the
 * index alone, so two funders never generate the same sequence.
 */
function makeGrant(funder, index) {
  const rng = stream(hash(`${funder.id}#${index}`));

  const theme = pick(rng, funder.themes);
  const spec = THEMES[theme];

  // Recipients who actually do this work, and who the funder could plausibly
  // reach. Falling back to any recipient for the theme keeps the corpus from
  // silently dropping a funder/theme pair.
  const inRegion = RECIPIENTS.filter(
    (r) => r.themes.includes(theme) && funder.regions.includes(r.region),
  );
  const anywhere = RECIPIENTS.filter((r) => r.themes.includes(theme));
  const pool = inRegion.length > 0 && rng() < 0.85 ? inRegion : anywhere;
  const recipient = pick(rng, pool.length > 0 ? pool : RECIPIENTS);

  // Log-uniform inside the funder's band: a corpus of round mid-band numbers
  // makes every amount filter look the same.
  const [low, high] = funder.band;
  const raw = Math.exp(between(rng, Math.log(low), Math.log(high)));
  const step = raw < 5_000 ? 50 : raw < 50_000 ? 250 : 5_000;
  const amount = Math.max(low, Math.round(raw / step) * step);

  // Mostly inside the three-year window; about one in twenty-five older, so
  // the window has something to drop and the console has something to count.
  const old = rng() < 0.04;
  const daysAgo = old ? 1_100 + Math.floor(rng() * 900) : Math.floor(rng() * 1_050);
  const awarded = new Date(TODAY.getTime() - daysAgo * DAY).toISOString().slice(0, 10);

  const title = pick(rng, spec.titles);
  const description = pick(rng, spec.descriptions);
  // The place is the recipient's, which is how real data reads; a fifth of
  // grants also carry the funder's own wider framing.
  const places = [{ name: recipient.region }, { name: 'England' }];
  if (rng() < 0.2) places.splice(1, 0, { name: 'South West' });

  const id = `${funder.id}-${String(index).padStart(4, '0')}`;
  return {
    grant_id: id,
    data: {
      id,
      title: `${title}${rng() < 0.35 ? `, ${recipient.region}` : ''}`,
      description,
      currency: 'GBP',
      amountAwarded: amount,
      awardDate: `${awarded}T00:00:00+00:00`,
      plannedDates: [{ duration: pick(rng, [12, 12, 18, 24, 36]) }],
      fundingOrganization: [{ id: funder.id, name: funder.name }],
      recipientOrganization: [
        { id: recipient.id, name: recipient.name, charityNumber: recipient.id.startsWith('GB-CHC') ? recipient.id.slice(7) : undefined },
      ],
      beneficiaryLocation: places,
      classifications: [{ title: spec.label }],
    },
    data_license: {
      url: 'https://creativecommons.org/licenses/by/4.0/',
      name: 'CC BY 4.0',
    },
    funders: [{ org_id: funder.id }],
    additional_data: {
      metadata: {
        source_license: 'https://creativecommons.org/licenses/by/4.0/',
        source_license_name: 'CC BY 4.0',
        publisher_name: funder.name,
      },
    },
  };
}

const CORPUS = new Map(
  FUNDERS.map((funder) => [
    funder.id,
    Array.from({ length: funder.grants }, (_, index) => makeGrant(funder, index)),
  ]),
);

/* ------------------------------------------------------------------ *
 * --print: the distribution, so degeneracy is visible.
 * ------------------------------------------------------------------ */

const money = (n) => `£${n.toLocaleString('en-GB')}`;

function report() {
  const all = [...CORPUS.values()].flat();
  const count = (fn) => {
    const seen = new Map();
    for (const grant of all) {
      const key = fn(grant);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return seen;
  };

  const titles = count((g) => g.data.title);
  const descriptions = count((g) => g.data.description);
  const recipients = count((g) => g.data.recipientOrganization[0].name);
  const places = count((g) => g.data.beneficiaryLocation[0].name);
  const labels = count((g) => g.data.classifications[0].title);
  const amounts = all.map((g) => g.data.amountAwarded).toSorted((a, b) => a - b);
  const older = all.filter((g) => g.data.awardDate < '2023-09-01').length;

  console.log(`grants            ${all.length} across ${FUNDERS.length} funders`);
  console.log(`distinct titles   ${titles.size}`);
  console.log(`distinct prose    ${descriptions.size}`);
  console.log(`recipients        ${recipients.size} of ${RECIPIENTS.length} reached`);
  console.log(`places            ${[...places.keys()].join(', ')}`);
  console.log(`labels            ${[...labels.keys()].join(', ')}`);
  console.log(
    `amounts           ${money(amounts[0])} – ${money(amounts.at(-1))}, ` +
      `median ${money(amounts[Math.floor(amounts.length / 2)])}`,
  );
  console.log(`outside 3 years   ${older} (the window has something to drop)`);

  const top = [...recipients.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('\nmost-funded recipients');
  for (const [name, n] of top) console.log(`  ${String(n).padStart(3)}  ${name}`);

  const nursery = all.filter((g) => /tree nursery|sapling|native trees/i.test(`${g.data.title} ${g.data.description}`));
  const funders = new Set(nursery.map((g) => g.data.fundingOrganization[0].name));
  console.log(`\ntree-nursery grants ${nursery.length}, from ${funders.size} funders`);
}

/* ------------------------------------------------------------------ *
 * The API, in the shape the connector reads.
 * ------------------------------------------------------------------ */

/**
 * Optional latency, in milliseconds per request.
 *
 * Because some faults only exist while the corpus is being written: the
 * `/grants` hydration mismatch is documented as living inside a load, and a
 * stub that answers instantly closes that window before anything can look at
 * it. `--slow 400` makes a thirteen-publisher walk take long enough to hold a
 * page open during it.
 */
function serve(port, slowMs = 0) {
  const api = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://stub');
    response.setHeader('content-type', 'application/json');
    if (slowMs > 0) {
      // Delay the WHOLE reply, headers included, so the client waits rather
      // than reading a body that is merely late.
      const end = response.end.bind(response);
      response.end = (...args) => {
        setTimeout(() => end(...args), slowMs);
        return response;
      };
    }

    if (url.pathname === '/api/v1/org/funder/') {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '50');
      response.end(
        JSON.stringify({
          count: FUNDERS.length,
          results: FUNDERS.slice(offset, offset + limit).map((f) => ({
            org_id: f.id,
            name: f.name,
          })),
        }),
      );
      return;
    }

    const made = /^\/api\/v1\/org\/([^/]+)\/grants_made\/$/u.exec(url.pathname);
    if (made) {
      const id = decodeURIComponent(made[1]);
      const funder = FUNDERS.find((f) => f.id === id);
      if (funder?.broken) {
        // A publisher that is there and cannot be read. The console has to
        // account for it rather than counting it as read.
        response.statusCode = 502;
        response.end(JSON.stringify({ detail: 'upstream unavailable' }));
        return;
      }
      const grants = CORPUS.get(id) ?? [];
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100);
      const page = grants.slice(offset, offset + limit);
      const more = offset + limit < grants.length;
      response.end(
        JSON.stringify({
          count: grants.length,
          next: more
            ? `http://127.0.0.1:${port}/api/v1/org/${encodeURIComponent(id)}/grants_made/?offset=${offset + limit}&limit=${limit}`
            : null,
          results: page,
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ detail: 'not found' }));
  });

  api.listen(port, '127.0.0.1', () => {
    const all = [...CORPUS.values()].flat().length;
    console.log(
      `stub 360Giving on http://127.0.0.1:${port}/api/v1/ — ` +
        `${FUNDERS.length} funders, ${all} grants (fictional)`,
    );
  });
  return api;
}

const args = process.argv.slice(2);
if (args.includes('--print')) {
  report();
} else {
  const at = args.indexOf('--port');
  const slow = args.indexOf('--slow');
  serve(
    at === -1 ? 4599 : Number(args[at + 1]),
    slow === -1 ? 0 : Number(args[slow + 1]),
  );
}
