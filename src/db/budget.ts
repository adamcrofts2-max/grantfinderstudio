/**
 * The budget for one application. TENANT path, tenant-owned data.
 *
 * ## Why this file did not exist until now
 *
 * `budgets` and `budget_lines` have been in the schema since 0001 and
 * `validateBudget` has been complete and tested for as long, and no code
 * between them ever touched either table. Meanwhile the readiness card on
 * every application read "No budget has been built." — naming a gap nobody
 * could close and scoring the application down for it. Same shape as the
 * missing answer box: the domain was built, the table was built, the form was
 * missing, and nothing failed loudly enough for anybody to notice.
 *
 * One budget per application, enforced by a UNIQUE on `application_id` in
 * 0001, so the budget is created lazily by the first line rather than being a
 * thing somebody has to make first.
 */

import type { Queryable } from './client.js';
import type { BudgetLine, CostCategory } from '../domain/budget/validate.js';

export interface NewBudgetLine {
  category: CostCategory;
  description: string;
  amountGbp: number;
}

interface LineRow {
  id: string;
  category: CostCategory;
  description: string;
  amount_gbp: string;
}

/** The budget's lines, oldest first, or an empty array when there is none. */
export async function loadBudgetLines(
  tx: Queryable,
  applicationId: string,
): Promise<BudgetLine[]> {
  const { rows } = await tx.query<LineRow>(
    `SELECT l.id, l.category, l.description, l.amount_gbp::text AS amount_gbp
       FROM budget_lines l
       JOIN budgets b ON b.id = l.budget_id
      WHERE b.application_id = $1
      ORDER BY l.id`,
    [applicationId],
  );
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    description: row.description,
    amountGbp: Number(row.amount_gbp),
  }));
}

/**
 * Add a line, creating the budget if this is the first one.
 *
 * `ON CONFLICT (application_id) DO UPDATE` rather than a SELECT then an
 * INSERT: two lines added at once would otherwise race to create the budget
 * and one of them would fail on the unique index. `DO UPDATE` rather than
 * `DO NOTHING` because only an UPDATE returns the existing row's id.
 */
export async function addBudgetLine(
  tx: Queryable,
  organisationId: string,
  applicationId: string,
  line: NewBudgetLine,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO budgets (id, organisation_id, application_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (application_id) DO UPDATE SET application_id = budgets.application_id
     RETURNING id`,
    [`bud_${applicationId}`, organisationId, applicationId],
  );
  const budgetId = rows[0]?.id;
  if (budgetId === undefined) {
    throw new Error('The budget could not be created.');
  }

  const lineId = `bl_${applicationId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await tx.query(
    `INSERT INTO budget_lines (id, organisation_id, budget_id, category, description, amount_gbp)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [lineId, organisationId, budgetId, line.category, line.description, line.amountGbp],
  );
  return lineId;
}

/**
 * Remove a line.
 *
 * Scoped by application as well as by id. RLS already confines this to the
 * tenant, but a line id from one of your own applications should not reach
 * into another, and the join says so rather than trusting the id.
 */
export async function deleteBudgetLine(
  tx: Queryable,
  applicationId: string,
  lineId: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `DELETE FROM budget_lines
      WHERE id = $1
        AND budget_id IN (SELECT id FROM budgets WHERE application_id = $2)
      RETURNING id`,
    [lineId, applicationId],
  );
  return rows.length > 0;
}
