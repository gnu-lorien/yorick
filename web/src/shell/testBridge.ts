import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { requireModules } from './e2eModelApi';

/**
 * The handful of things the Playwright suite needs from inside the page.
 *
 * The suite is 24,000 lines and it is the parity gate, so it is not being
 * rewritten to suit the React app; the helpers detect which front end they are
 * talking to and ask each one in its own terms. On the legacy side those terms
 * are `window.require` and `window.jQuery.mobile`. Here they are this object.
 *
 * It is deliberately tiny, and everything in it exists because a helper needs
 * it, not because it might be handy:
 *
 * - `redispatch` is what `navigateToHash` calls when the hash it wants is
 *   already the current one. The legacy suite drives `Backbone.history.loadUrl`
 *   for this. React re-renders from the hash, so an unchanged hash renders
 *   nothing new; what the suite actually means by "go there again" is "throw
 *   away what is on screen and fetch it fresh", which is what this does.
 * - `hardReset` is `hardReload` without the page load: several specs need a
 *   route handler to build a genuinely fresh view, which in the legacy app
 *   means defeating the router's memoised views.
 * - `require` answers the module names the suite's `runInApp` asks for. That is
 *   how it does fixture setup and assertion read-back -- through the app's own
 *   models rather than the UI -- and `e2eModelApi.ts` says why it keeps the
 *   legacy names.
 *
 * The first two are also what makes a React run *comparable* to a legacy run
 * rather than accidentally easier: TanStack Query would otherwise serve a
 * cached answer where the legacy app went back to the server.
 */

export interface YorickTestBridge {
  /** Present only on the React front end, so a helper can branch on it. */
  react: true;
  redispatch(): void;
  hardReset(): void;
  require(
    names: string[],
    callback: (...mods: unknown[]) => void,
    errback?: (error: Error) => void,
  ): void;
}

let generation = 0;
const listeners = new Set<() => void>();
let queryClient: QueryClient | null = null;

function bump(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

/**
 * A counter the shell uses as the screen's `key`.
 *
 * Bumping it unmounts the current screen and mounts a fresh one, which is the
 * only way to make a screen re-run its effects from the top without a
 * navigation.
 */
export function useScreenGeneration(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => generation,
    () => generation,
  );
}

/**
 * Install the bridge. Called once, from the entry point.
 *
 * It goes on `window` unconditionally rather than behind a build flag. A flag
 * would mean the suite exercises a build the users never get, which is the one
 * thing an end-to-end suite exists to avoid; and what is exposed here can
 * already be done from the address bar.
 */
export function installTestBridge(client: QueryClient): void {
  queryClient = client;
  const bridge: YorickTestBridge = {
    react: true,
    redispatch() {
      void queryClient?.invalidateQueries();
      bump();
    },
    hardReset() {
      queryClient?.clear();
      bump();
    },
    require: requireModules,
  };
  (window as unknown as { __yorick: YorickTestBridge }).__yorick = bridge;
}
