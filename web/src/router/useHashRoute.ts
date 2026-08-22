import { useSyncExternalStore } from 'react';
import { currentFragment, matchRoute, type RouteMatch } from './router';

/**
 * The current route, as React state.
 *
 * `useSyncExternalStore` rather than `useState` + a `hashchange` listener: the
 * hash is external state that can change between render and effect (a redirect
 * during bootstrap does exactly that), and this is the hook that is specified
 * to read it without tearing.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

// Cached so the snapshot is referentially stable while the hash is unchanged;
// returning a fresh object every read would loop.
let cachedFragment: string | null = null;
let cachedMatch: RouteMatch | null = null;

function getSnapshot(): RouteMatch | null {
  const fragment = currentFragment();
  if (fragment !== cachedFragment) {
    cachedFragment = fragment;
    cachedMatch = matchRoute(fragment);
  }
  return cachedMatch;
}

export function useHashRoute(): RouteMatch | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
