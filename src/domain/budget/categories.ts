/**
 * The cost categories, with the words an applicant would use for them.
 *
 * The category is the field that decides whether a line trips one of the
 * funder's rules, so the label has to make the choice obvious without a
 * glossary. "Overheads" and "management" are the pair people conflate, and
 * getting them the wrong way round is what puts a budget over an overhead cap,
 * so both say what belongs in them.
 *
 * Listed in the order a budget is usually built — people first, then what they
 * need, then the costs of running it — rather than alphabetically.
 */

import type { CostCategory } from './validate.js';

export interface CostCategoryOption {
  id: CostCategory;
  label: string;
  hint: string;
}

export const COST_CATEGORIES: readonly CostCategoryOption[] = [
  { id: 'staff', label: 'Staff', hint: 'Salaries and on-costs for people you employ.' },
  { id: 'freelancers', label: 'Freelancers', hint: 'Sessional workers, tutors, consultants.' },
  { id: 'venues', label: 'Venues', hint: 'Room hire, rent for the activity itself.' },
  { id: 'materials', label: 'Materials', hint: 'Consumables used up by the work.' },
  { id: 'equipment', label: 'Equipment', hint: 'Things you keep and use again. Counts as capital to most funders.' },
  { id: 'travel', label: 'Travel', hint: 'Fares, mileage, transport for participants.' },
  { id: 'training', label: 'Training', hint: 'Courses and qualifications, for staff or participants.' },
  { id: 'marketing', label: 'Reaching people', hint: 'Print, advertising, outreach to find participants.' },
  { id: 'evaluation', label: 'Evaluation', hint: 'Measuring whether it worked. Fund it — most funders expect it.' },
  { id: 'management', label: 'Project management', hint: 'Coordinating this project specifically.' },
  { id: 'overheads', label: 'Overheads', hint: 'A share of costs you would have anyway — premises, insurance, finance. Not project management.' },
  { id: 'capital', label: 'Capital', hint: 'Building work, vehicles, permanent installations.' },
] as const;

/**
 * Whether a posted value is a category.
 *
 * The browser is not a trustworthy source, and the column is a Postgres enum:
 * an unrecognised value would otherwise reach the database and fail there,
 * turning a bad select into a 500 rather than a message.
 */
export function isCostCategory(value: unknown): value is CostCategory {
  return (
    typeof value === 'string' && COST_CATEGORIES.some((category) => category.id === value)
  );
}

export function categoryLabel(id: CostCategory): string {
  return COST_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
