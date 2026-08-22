import { extractParameters, routeToRegExp } from './backboneRoutes';
import { routeTable, type RouteEntry } from './routeTable';

/**
 * Matching a URL fragment to a route, with Backbone's semantics.
 *
 * Backbone tried each route in declaration order and took the first match, so
 * this does too -- `troupe/new` has to win over `troupe/:id`, and reordering
 * the table would break it. Nothing here sorts or optimises the list.
 */

export interface RouteMatch {
  entry: RouteEntry;
  /** Positional captures, in Backbone's order, with its trailing query slot. */
  params: (string | null)[];
  /** The same values keyed by the `:name` they came from. */
  named: Record<string, string | undefined>;
  /** The trailing `?...` Backbone always captures last, parsed. */
  query: URLSearchParams;
  fragment: string;
}

interface CompiledRoute {
  entry: RouteEntry;
  regexp: RegExp;
  paramNames: string[];
}

/**
 * The `:name` parameters in a pattern, in order.
 *
 * Deliberately mirrors `namedParam` from Backbone's compiler so the names line
 * up one-for-one with its captures. Splats (`*name`) do not occur in this app's
 * table; if one is ever added it will have no name here, which is why callers
 * get `params` as well as `named`.
 */
function paramNamesOf(pattern: string): string[] {
  return [...pattern.matchAll(/(\(\?)?:(\w+)/g)].filter((m) => !m[1]).map((m) => m[2]!);
}

const compiled: CompiledRoute[] = routeTable.map((entry) => ({
  entry,
  regexp: routeToRegExp(entry.pattern),
  paramNames: paramNamesOf(entry.pattern),
}));

/** Strip the leading `#` (and `#!`) the way Backbone's history did. */
export function fragmentFromHash(hash: string): string {
  return hash.replace(/^#!?/, '');
}

export function matchRoute(fragment: string): RouteMatch | null {
  for (const route of compiled) {
    if (!route.regexp.test(fragment)) continue;
    const params = extractParameters(route.regexp, fragment);

    const named: Record<string, string | undefined> = {};
    route.paramNames.forEach((name, i) => {
      named[name] = params[i] ?? undefined;
    });

    // Backbone always appends one capture for a trailing query string; it is
    // the last slot, and it is null when the URL had none. Note that routes
    // like `characters?:type` put "all" in a *named* slot instead, because
    // their "?" is literal -- see backboneRoutes.ts.
    const trailing = params.length > route.paramNames.length ? params[params.length - 1] : null;

    return {
      entry: route.entry,
      params,
      named,
      query: new URLSearchParams(trailing ?? ''),
      fragment,
    };
  }
  return null;
}

/** The current fragment, from `location.hash`. */
export function currentFragment(): string {
  return fragmentFromHash(window.location.hash);
}

/**
 * Go to a fragment.
 *
 * Replaces the legacy app's 76 `$.mobile.changePage` calls. jQM's version took
 * a page selector and a transition; navigation and rendering were the same
 * act. Here the hash is the only input, and rendering follows from it, which
 * is what removes the class of bug `_routeGeneration`/`ifCurrent()` exists to
 * work around in mobileRouter.js: a stale async chain can no longer commit a
 * page transition, because it cannot transition anything.
 */
export function navigate(fragment: string, opts: { replace?: boolean } = {}): void {
  const target = fragment.startsWith('#') ? fragment : `#${fragment}`;
  if (opts.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}
