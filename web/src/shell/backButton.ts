import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';

/**
 * Where the header's Back button goes.
 *
 * The legacy router sets this per route, before it transitions:
 *
 *     set_back_button: function (url) { $("#header-back-button").attr("href", url); }
 *
 * -- mobileRouter.js:406, called by ~20 handlers with things like
 * `"#character?" + cid` or `"#administration/users/all"`. So Back is not
 * browser history: it is a destination the screen chooses, and on several
 * screens the two differ. Arriving at a character's costs page from a deep link
 * has no history to go back to, but `#character?<cid>` is still the right place
 * to send someone.
 *
 * A screen declares its target with `useBackButton("#somewhere")`. The header
 * reads it. It is an external store rather than a context because the value
 * flows the wrong way for props -- the screen is *below* the header in the tree
 * -- and threading it through the shell would mean every screen's route params
 * being known to App.tsx.
 *
 * A screen that declares nothing gets the default: `history.back()`, which is
 * what jqm/Toolbar.tsx does when no href is set.
 */

let target: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string | null {
  return target;
}

function set(next: string | null): void {
  if (target === next) return;
  target = next;
  listeners.forEach((l) => l());
}

/**
 * Point the header's Back button at `href` while this screen is on show.
 *
 * Clears on unmount, so a screen that does not declare a target never inherits
 * the previous one's -- which is the bug the legacy version has, since
 * `set_back_button` only ever writes and the attribute persists until the next
 * handler happens to overwrite it.
 */
export function useBackButton(href: string | null | undefined): void {
  useEffect(() => {
    set(href ?? null);
    return () => set(null);
  }, [href]);
}

/** The current Back target, or null to fall back to browser history. */
export function useBackTarget(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
