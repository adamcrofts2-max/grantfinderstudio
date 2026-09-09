/** What an admin-roster form hands back to the screen. */
export interface RosterState {
  ok: boolean;
  message: string;
  problems: string[];
  /** Which row the message belongs to, so one banner does not answer for all. */
  adminId: string | null;
  /**
   * When this outcome was produced.
   *
   * Two actions can carry a message about the SAME row — standing somebody
   * down and bringing them back — and the screen holds the last result of
   * each. Without a clock the older one wins whenever it is checked first,
   * which is how a restored admin ends up captioned "stood down".
   */
  at: number;
  email: string;
}

export const EMPTY_ROSTER: RosterState = {
  ok: true,
  message: '',
  problems: [],
  adminId: null,
  at: 0,
  email: '',
};
