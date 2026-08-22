/**
 * Backbone 1.1.2's route compiler, ported verbatim.
 *
 * The legacy route table is not expressible in any off-the-shelf React router.
 * It contains patterns like `category?:type`, `characters?:type` and
 * `simpletrait/spacer/:category/:cid/:name/:value/:free_value/new` -- the first
 * two put a *literal question mark* in the middle of the pattern, which
 * Backbone escapes and then matches, while React Router would read it as the
 * start of a query string and never match at all.
 *
 * Every one of those URLs is a bookmark someone may hold, and all 24k lines of
 * the Playwright suite navigate by hash. So the safe move is not to translate
 * the patterns into another router's dialect -- it is to keep Backbone's
 * matching semantics exactly and let the same table drive React. The three
 * regexes and the two functions below are Backbone's own, unchanged apart from
 * types.
 *
 * Source: backbone.js 1.1.2, `Router.prototype._routeToRegExp` and
 * `_extractParameters` (vendored at public/scripts/lib/backbone.js).
 */

const optionalParam = /\((.*?)\)/g;
const namedParam = /(\(\?)?:\w+/g;
const splatParam = /\*\w+/g;
const escapeRegExp = /[\-{}\[\]+?.,\\\^$|#\s]/g;

/** Turn a route pattern into the regex Backbone would have produced for it. */
export function routeToRegExp(route: string): RegExp {
  const source = route
    .replace(escapeRegExp, '\\$&')
    .replace(optionalParam, '(?:$1)?')
    .replace(namedParam, (match, optional) => (optional ? match : '([^/?]+)'))
    .replace(splatParam, '([^?]*?)');
  return new RegExp('^' + source + '(?:\\?([\\s\\S]*))?$');
}

/**
 * Pull the parameters out of a matched fragment.
 *
 * Backbone drops the final capture -- the trailing query string its regex
 * always appends -- when it is undefined, and decodes the rest. Note that a
 * pattern like `category?:type` captures "all" in a *named* group rather than
 * the query group, because the `?` is literal; that asymmetry is why this has
 * to be Backbone's implementation rather than a reasonable one.
 */
export function extractParameters(route: RegExp, fragment: string): (string | null)[] {
  const result = route.exec(fragment);
  if (!result) return [];
  const params = result.slice(1);
  return params.map((param, i) => {
    // Don't decode the search params.
    if (i === params.length - 1) return param || null;
    return param ? decodeURIComponent(param) : null;
  });
}
