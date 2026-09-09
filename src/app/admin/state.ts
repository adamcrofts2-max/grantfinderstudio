export interface AdminAuthState {
  ok: boolean;
  message: string;
  problems: string[];
  email: string;
}

export const EMPTY_ADMIN_AUTH: AdminAuthState = {
  ok: true,
  message: '',
  problems: [],
  email: '',
};
