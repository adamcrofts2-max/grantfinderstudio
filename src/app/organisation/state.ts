export interface FactActionState {
  factId: string | null;
  ok: boolean;
  message: string;
}

export const EMPTY_FACT_ACTION: FactActionState = { factId: null, ok: false, message: '' };

export interface SelfDeclaredState {
  saved: boolean;
  message: string;
  errors: Record<string, string>;
}

export const EMPTY_SELF_DECLARED: SelfDeclaredState = {
  saved: false,
  message: '',
  errors: {},
};
