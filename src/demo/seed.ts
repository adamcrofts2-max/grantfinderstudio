/**
 * Demonstration data.
 *
 * EVERYTHING HERE IS FICTIONAL. The funders, funds, awards and organisation do
 * not exist. It is seeded only so the application can be exercised end to end
 * before real ingested data is available, and the interface labels it as
 * fictional wherever it appears.
 *
 * It is deliberately shaped to produce all three eligibility verdicts, because
 * the honest handling of "ineligible" and "we do not know" matters more than
 * the happy path.
 */

import type { Queryable } from '../db/client.js';

export const DEMO_ORG_ID = 'demo_org';
export const DEMO_USER_ID = 'demo_user';

export async function seedDemoData(db: Queryable): Promise<void> {
  await db.query(`
    INSERT INTO users (id, email, name)
    VALUES ('${DEMO_USER_ID}', 'demo@example.org', 'Demo User')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO organisations (id, name)
    VALUES ('${DEMO_ORG_ID}', 'Mendip Green Futures CIC (fictional)')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO memberships (id, organisation_id, user_id, role)
    VALUES ('demo_m', '${DEMO_ORG_ID}', '${DEMO_USER_ID}', 'owner')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO organisation_profiles
      (id, organisation_id, legal_name, company_number, form,
       incorporation_date, jurisdiction, region, annual_turnover_gbp, mission)
    VALUES
      ('demo_p', '${DEMO_ORG_ID}', 'Mendip Green Futures CIC (fictional)', '00000000',
       'cic_limited_by_guarantee', '2020-01-15', 'england', 'Somerset', 120000,
       'Helping disadvantaged young people learn practical environmental skills.')
    ON CONFLICT (organisation_id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO projects
      (id, organisation_id, name, description, beneficiary_groups, region,
       amount_sought_gbp, duration_months)
    VALUES
      ('demo_proj', '${DEMO_ORG_ID}', 'Green Skills Programme',
       'A 12-month programme teaching practical environmental skills to young people in Somerset.',
       ARRAY['young people'], 'Somerset', 30000, 12)
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO source_datasets
      (id, name, publisher, licence, licence_url, attribution, retrieved_at)
    VALUES
      ('demo_ds', 'Demonstration awards (fictional)', 'Grant Finder Studio',
       'CC-BY-4.0', 'https://creativecommons.org/licenses/by/4.0/',
       'Fictional demonstration data — not real grants', '2026-09-01T00:00:00Z')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO funders (id, name, jurisdiction, stated_priorities, source_dataset_id)
    VALUES
      ('f_youth', 'The Fictional Youth Trust', 'england',
       'Young people, education and employability.', 'demo_ds'),
      ('f_heritage', 'The Fictional Heritage Foundation', 'uk_wide',
       'Buildings and heritage conservation.', 'demo_ds'),
      ('f_coast', 'The Fictional Coastal Fund', 'england',
       'Coastal communities and the natural environment.', 'demo_ds')
    ON CONFLICT (id) DO NOTHING
  `);

  // Award amounts are chosen so the interquartile range is easy to read:
  // 8k / 15k / 22k / 31k / 40k gives a typical range of 15k-31k.
  const amounts = [8000, 15_000, 22_000, 31_000, 40_000];
  for (const [index, amount] of amounts.entries()) {
    await db.query(
      `INSERT INTO funder_awards
         (id, funder_id, recipient_name, amount_gbp, awarded_on, description,
          jurisdiction, region, source_dataset_id)
       VALUES ($1, 'f_youth', $2, $3, $4, 'Fictional award record',
               'england', $5, 'demo_ds')
       ON CONFLICT (id) DO NOTHING`,
      [
        `aw_${index}`,
        `Fictional Recipient ${index + 1}`,
        amount,
        `2025-0${index + 1}-01`,
        index < 3 ? 'Somerset' : 'Devon',
      ],
    );
  }

  await db.query(`
    INSERT INTO opportunities
      (id, funder_id, title, summary, min_amount_gbp, max_amount_gbp, jurisdiction,
       deadline, deadline_kind, freshness_state, source_url, source_dataset_id,
       retrieved_at, verified_at)
    VALUES
      ('opp_youth', 'f_youth', 'Fictional Youth Futures Fund',
       'Supports programmes helping young people gain practical skills.',
       5000, 50000, 'england', '2026-11-30', 'confirmed', 'current',
       'https://example.org/fictional-youth-fund', 'demo_ds',
       '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ('opp_heritage', 'f_heritage', 'Fictional Heritage Buildings Grant',
       'Capital works on historic buildings. Registered charities only.',
       25000, 250000, 'uk_wide', '2026-10-15', 'estimated', 'needs_verification',
       'https://example.org/fictional-heritage-grant', 'demo_ds',
       '2026-06-02T00:00:00Z', NULL),
      ('opp_coast', 'f_coast', 'Fictional Coastal Communities Fund',
       'Environmental projects benefiting coastal communities.',
       10000, 40000, 'england', NULL, 'rolling', 'recently_verified',
       'https://example.org/fictional-coastal-fund', 'demo_ds',
       '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')
    ON CONFLICT (id) DO NOTHING
  `);

  // Facts the organisation has gathered but not yet checked. They deliberately
  // arrive unconfirmed: nothing may ground a funding application until a person
  // has said it is true.
  await db.query(`
    INSERT INTO facts
      (id, organisation_id, claim, value, source, source_ref, source_span,
       retrieved_at, confidence_level)
    VALUES
      ('fact_name', '${DEMO_ORG_ID}', 'legal_name', 'Mendip Green Futures CIC (fictional)',
       'companies_house', 'companies-house:00000000',
       'Company name: MENDIP GREEN FUTURES CIC', now(), 'high'),
      ('fact_form', '${DEMO_ORG_ID}', 'legal_form', 'community interest company limited by guarantee',
       'companies_house', 'companies-house:00000000',
       'Company type: private-limited-guarant-nsc', now(), 'high'),
      ('fact_inc', '${DEMO_ORG_ID}', 'incorporation_date', '15 January 2020',
       'companies_house', 'companies-house:00000000',
       'Incorporated on 15 January 2020', now(), 'high'),
      ('fact_area', '${DEMO_ORG_ID}', 'area_of_operation', 'Somerset, principally Wells and the surrounding villages',
       'document', 'annual-report-2025',
       'We work across Somerset, principally in Wells and the surrounding villages.', now(), 'high'),
      ('fact_turnover', '${DEMO_ORG_ID}', 'annual_turnover', '£118,400 for the year ending 31 March 2025',
       'document', 'annual-report-2025',
       'Our turnover for the year ending 31 March 2025 was £118,400.', now(), 'high'),
      ('fact_staff', '${DEMO_ORG_ID}', 'staff_count', 'four members of staff, 3.2 full-time equivalent',
       'document', 'annual-report-2025',
       'We employ four members of staff (3.2 full-time equivalent).', now(), 'high'),
      ('fact_vols', '${DEMO_ORG_ID}', 'volunteer_count', '27 regular volunteers',
       'document', 'annual-report-2025',
       'We work with 27 regular volunteers.', now(), 'medium'),
      ('fact_prog', '${DEMO_ORG_ID}', 'programme', 'the Green Skills Programme, a twelve-week practical skills course for young people aged 14 to 19',
       'document', 'annual-report-2025',
       'Our Green Skills Programme worked with young people aged 14 to 19 over twelve weeks.', now(), 'high'),
      ('fact_safeguarding', '${DEMO_ORG_ID}', 'safeguarding_policy', 'current, last reviewed September 2025',
       'document', 'annual-report-2025',
       'We hold a current safeguarding policy, reviewed in September 2025.', now(), 'high')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO eligibility_criteria
      (id, opportunity_id, kind, label, params, cic_handling, verified_by, verified_at)
    VALUES
      -- Youth fund: a clean fit.
      ('c_y1', 'opp_youth', 'legal_form', 'Legal form', '{}', 'explicitly_permitted',
       '${DEMO_USER_ID}', '2026-09-01T00:00:00Z'),
      ('c_y2', 'opp_youth', 'jurisdiction', 'Area covered',
       '{"permitted":["england"]}', NULL, '${DEMO_USER_ID}', '2026-09-01T00:00:00Z'),
      ('c_y3', 'opp_youth', 'amount', 'Grant size',
       '{"minGbp":5000,"maxGbp":50000}', NULL, '${DEMO_USER_ID}', '2026-09-01T00:00:00Z'),
      ('c_y4', 'opp_youth', 'organisation_age', 'Trading history',
       '{"minMonths":24}', NULL, '${DEMO_USER_ID}', '2026-09-01T00:00:00Z'),
      ('c_y5', 'opp_youth', 'beneficiary', 'Who it is for',
       '{"anyOf":["young people"]}', NULL, '${DEMO_USER_ID}', '2026-09-01T00:00:00Z'),

      -- Heritage fund: excludes CICs outright, and wants capital spending.
      ('c_h1', 'opp_heritage', 'legal_form', 'Legal form', '{}', 'charity_only',
       '${DEMO_USER_ID}', '2026-06-02T00:00:00Z'),
      ('c_h2', 'opp_heritage', 'capital_revenue', 'Type of cost',
       '{"permitted":["capital"]}', NULL, '${DEMO_USER_ID}', '2026-06-02T00:00:00Z'),
      ('c_h3', 'opp_heritage', 'amount', 'Grant size',
       '{"minGbp":25000,"maxGbp":250000}', NULL, '${DEMO_USER_ID}', '2026-06-02T00:00:00Z'),

      -- Coastal fund: says nothing about CICs, and match funding is unclear.
      ('c_c1', 'opp_coast', 'legal_form', 'Legal form', '{}', 'not_stated',
       '${DEMO_USER_ID}', '2026-08-20T00:00:00Z'),
      ('c_c2', 'opp_coast', 'jurisdiction', 'Area covered',
       '{"permitted":["england"]}', NULL, '${DEMO_USER_ID}', '2026-08-20T00:00:00Z'),
      ('c_c3', 'opp_coast', 'amount', 'Grant size',
       '{"minGbp":10000,"maxGbp":40000}', NULL, '${DEMO_USER_ID}', '2026-08-20T00:00:00Z'),
      ('c_c4', 'opp_coast', 'match_funding', 'Match funding',
       '{"required":true}', NULL, '${DEMO_USER_ID}', '2026-08-20T00:00:00Z')
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * Application form characteristics for each demonstration fund.
 *
 * In the finished product these come from analysing the funder's own form.
 * Here they are stated as fictional fixtures.
 */
export const DEMO_APPLICATION_FEATURES: Record<
  string,
  {
    questionCount: number;
    totalWordBudget: number;
    requiredAttachments: number;
    requiresLatestAccounts: boolean;
    requiredPolicies: string[];
    requiresMatchFunding: boolean;
    requiresBudgetTemplate: boolean;
  }
> = {
  opp_youth: {
    questionCount: 8,
    totalWordBudget: 1200,
    requiredAttachments: 2,
    requiresLatestAccounts: true,
    requiredPolicies: ['safeguarding'],
    requiresMatchFunding: false,
    requiresBudgetTemplate: false,
  },
  opp_heritage: {
    questionCount: 22,
    totalWordBudget: 4500,
    requiredAttachments: 6,
    requiresLatestAccounts: true,
    requiredPolicies: ['safeguarding', 'equal opportunities', 'environmental'],
    requiresMatchFunding: true,
    requiresBudgetTemplate: true,
  },
  opp_coast: {
    questionCount: 10,
    totalWordBudget: 2000,
    requiredAttachments: 3,
    requiresLatestAccounts: true,
    requiredPolicies: ['safeguarding'],
    requiresMatchFunding: true,
    requiresBudgetTemplate: true,
  },
};

/**
 * A worked application against the youth fund, with questions of the shape a
 * real UK funder asks. Fictional, like everything else here.
 */
export async function seedDemoApplication(db: Queryable): Promise<void> {
  await db.query(`
    INSERT INTO applications
      (id, organisation_id, opportunity_id, project_id, status, amount_requested_gbp)
    VALUES ('app_youth', '${DEMO_ORG_ID}', 'opp_youth', 'demo_proj', 'drafting', 30000)
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO application_questions
      (id, organisation_id, application_id, position, question, word_limit, assesses)
    VALUES
      ('q_about', '${DEMO_ORG_ID}', 'app_youth', 1,
       'Tell us about your organisation and the work you do.', 200,
       'whether you are a credible, established delivery organisation'),
      ('q_need', '${DEMO_ORG_ID}', 'app_youth', 2,
       'What need does your project address, and how do you know it exists?', 250,
       'whether the need is real and evidenced rather than assumed'),
      ('q_do', '${DEMO_ORG_ID}', 'app_youth', 3,
       'What will you actually do with this funding?', 250,
       'whether the plan is specific and deliverable'),
      ('q_reach', '${DEMO_ORG_ID}', 'app_youth', 4,
       'How many people will you support, and what difference will it make to them?', 200,
       'evidence of scale and of realistic outcomes')
    ON CONFLICT (id) DO NOTHING
  `);
}
