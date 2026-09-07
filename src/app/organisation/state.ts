export interface FactActionState {
  factId: string | null;
  ok: boolean;
  message: string;
}

export const EMPTY_FACT_ACTION: FactActionState = { factId: null, ok: false, message: '' };
