export interface CatalogueFormState {
  saved: boolean;
  message: string;
  errors: Record<string, string>;
}

export const EMPTY_CATALOGUE_FORM: CatalogueFormState = {
  saved: false,
  message: '',
  errors: {},
};
