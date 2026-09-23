'use client';

import { useEffect } from 'react';

/**
 * On a phone the sections are one row that scrolls sideways, so the one you
 * are on — Applications, say — could start off the right-hand edge, where
 * the "you are here" mark does nothing. This brings it into view once, on
 * arrival. Nothing at all on wider screens, where the menu is a column.
 */
export function NavIntoView() {
  useEffect(() => {
    if (!window.matchMedia('(max-width: 820px)').matches) return;
    const current = document.querySelector<HTMLElement>('.sidebar .nav [aria-current="page"]');
    current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);
  return null;
}
