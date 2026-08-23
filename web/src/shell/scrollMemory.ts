import { useLayoutEffect, useRef } from 'react';

/**
 * Returning a long page to where the reader left it.
 *
 * Ports `backToTop` and the two restores that read it: the creation wizard's
 * `scroll_back_after_page_change` (CharacterCreateViewNew.js) and the character
 * sheet's `restore_scroll_after_page_change` (CharacterView.js). Both are long
 * pages that every action leaves and returns to, so without this a player who
 * acts halfway down is sent back to the top each time.
 *
 * The legacy records the offset in the route handler of the screen being opened,
 * reading the scroll position before `changePage` moves off the one being left.
 * React has no such moment -- the next screen mounts after the navigation -- so
 * the page records its own position on the way out. Same number, taken from the
 * only side that reliably knows it.
 *
 * `useLayoutEffect`, not `useEffect`: a passive cleanup runs after the old page
 * has gone and been replaced, by which point the browser has clamped the offset
 * to the height of whatever came next -- usually zero, since a picker for three
 * attributes is a very short page.
 */

const remembered = new Map<string, number>();

export interface ScrollMemoryOptions {
  /** Distinguishes the wizard's offset from the sheet's. */
  key: string;
  /** Whether the page has its content. Restoring an empty page clamps to zero. */
  ready: boolean;
  /**
   * Whether restoring clears the offset.
   *
   * The sheet's does -- `self.backToTop = 0` on sight, so a stale offset cannot
   * be reused by a later visit. The wizard's does not: `backToTop` lives on the
   * router's memoised view for the life of the page, so the legacy restores the
   * last recorded position on any return, not only on a return from a pick.
   */
  consume: boolean;
  /**
   * Keep retrying until the page is tall enough to hold the offset.
   *
   * The sheet needs it and the wizard does not, which is the legacy's own
   * split. `pagechange` fires before the sheet has finished growing -- measured
   * there at 81px scrollable, and 1879px a moment later -- so an immediate
   * scroll went nowhere and nothing ran again once it had its height. React
   * renders the sheet in one commit, but its portrait loads afterwards and
   * changes the height, so the wait earns its keep here too.
   */
  waitForHeight?: boolean;
}

/** 40 attempts at 50ms: two seconds, from CharacterView.js. */
const MAX_ATTEMPTS = 40;
const INTERVAL_MS = 50;

/**
 * Past this, the reader has scrolled for themselves and has taken over.
 *
 * A fresh page change starts at the top, so anything else is a real scroll and
 * yanking the page out from under them would be worse than not restoring.
 */
const TOP_SLACK = 2;

export function useScrollMemory({ key, ready, consume, waitForHeight }: ScrollMemoryOptions): void {
  // Record on the way out.
  useLayoutEffect(() => {
    return () => {
      remembered.set(key, window.scrollY);
    };
  }, [key]);

  // Restore once there is a page tall enough to scroll.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!ready || restored.current) return;
    const top = remembered.get(key);
    if (top === undefined || top <= 0) return;
    restored.current = true;
    if (consume) remembered.delete(key);

    if (!waitForHeight) {
      window.scrollTo(0, top);
      return;
    }

    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (window.scrollY > TOP_SLACK) return;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (room >= top) {
        window.scrollTo(0, top);
        return;
      }
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) timer = setTimeout(attempt, INTERVAL_MS);
    };
    attempt();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [ready, key, consume, waitForHeight]);
}
