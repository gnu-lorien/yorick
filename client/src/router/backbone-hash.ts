/**
 * Backbone-compatible hash routing for Vue Router.
 *
 * Vue Router's own `createWebHashHistory` cannot express this app's URLs, for
 * two independent reasons:
 *
 * 1. It always writes a leading slash -- `#/characters` -- where every URL this
 *    app has ever produced has none: `#characters?all`, `#character?abc123`,
 *    `#troupe/xyz/staff/add`.
 * 2. Backbone treats `?` as an ordinary character in a route pattern.
 *    `"characters?:type"` means "the literal text `characters?` followed by a
 *    parameter", and `#character?abc123` is a path, not a query string. Vue
 *    Router splits on `?` while parsing the URL, before any matching happens,
 *    so those four routes cannot be written as Vue paths at all.
 *
 * Changing the URLs is not an option worth taking. They are in players'
 * bookmarks; `navigateToHash` in the E2E helpers drives all 256 of its call
 * sites by them; and 53 further places in the suite read
 * `window.location.hash` directly, because a hash assignment is this app's only
 * signal that a save finished.
 *
 * So the router runs on an in-memory history over clean internal paths, and
 * this module translates in both directions. `#character?abc123` becomes the
 * internal path `/character/abc123` for matching, and any navigation to that
 * route writes `#character?abc123` back to the address bar. The visible URL is
 * byte-identical to what Backbone produced.
 *
 * The pattern syntax accepted here is Backbone's, so the route table can be
 * copied straight across from `mobileRouter.js:198-303` and diffed against it.
 */

/** One route's Backbone pattern paired with the internal path it maps to. */
export interface HashPattern {
  /** Backbone's own pattern, e.g. `character/:cid/log/:start/:changeBy`. */
  pattern: string
  /** The ordered parameter names appearing in it. */
  params: string[]
  /** A regexp matching a hash against this pattern. */
  regexp: RegExp
  /** The internal Vue Router path, e.g. `/character/:cid/log/:start/:changeBy`. */
  path: string
}

/** Characters that are special to a regexp and appear literally in patterns. */
const ESCAPE = /[-{}[\]+?.,\\^$|#\s]/g

/**
 * Compile a Backbone route pattern.
 *
 * Backbone's own compiler handles `:param`, `*splat` and `(optional)` parts.
 * This app's 96 routes use only `:param`, so only that is supported -- and a
 * pattern containing the others is rejected loudly rather than mis-compiled,
 * because a route that silently never matches is exactly the failure this
 * whole module exists to avoid.
 */
export function compilePattern(pattern: string): HashPattern {
  if (pattern.includes('*') || pattern.includes('(')) {
    throw new Error(`unsupported Backbone route pattern "${pattern}": splats and optional parts are not used by this app`)
  }

  const params: string[] = []
  let source = ''
  let path = ''

  // Split on parameters, keeping the literal text between them.
  const parts = pattern.split(/(:[A-Za-z_][A-Za-z0-9_]*)/)
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith(':')) {
      const name = part.slice(1)
      params.push(name)
      // `[^/]+` matches Backbone's own parameter expression, so a parameter
      // stops at a slash but happily contains `?`, `.` or a space.
      source += '([^/]+)'
      path += `/:${name}`
    } else {
      source += part.replace(ESCAPE, '\\$&')
      // Literal text becomes a path segment. `characters?` -- the literal text
      // of the `characters?:type` pattern -- would be an illegal Vue path, so
      // the trailing `?` is dropped from the INTERNAL path only. The hash
      // written back always comes from the pattern, so the URL is unaffected.
      const literal = part.replace(/\?$/, '').replace(/^\/+|\/+$/g, '')
      if (literal) path += '/' + literal
    }
  }

  return {
    pattern,
    params,
    regexp: new RegExp('^' + source + '$'),
    path: path || '/',
  }
}

/** The parameters a hash yields under a pattern, or null if it does not match. */
export function matchPattern(compiled: HashPattern, hash: string): Record<string, string> | null {
  const match = compiled.regexp.exec(hash)
  if (!match) return null
  const out: Record<string, string> = {}
  compiled.params.forEach((name, i) => {
    const raw = match[i + 1]
    // Backbone decoded parameters; character ids are safe but troupe and
    // character names reach some routes and can carry spaces.
    out[name] = raw === undefined ? '' : safeDecode(raw)
  })
  return out
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // A stray `%` in a name would otherwise throw URIError and take down the
    // whole navigation; the raw text is a better answer than a blank screen.
    return value
  }
}

/** Render a hash from a pattern and its parameter values. */
export function formatPattern(compiled: HashPattern, params: Record<string, unknown>): string {
  let out = compiled.pattern
  for (const name of compiled.params) {
    const value = params[name]
    out = out.replace(
      new RegExp(':' + name + '(?![A-Za-z0-9_])'),
      encodeURIComponent(value === undefined || value === null ? '' : String(value)),
    )
  }
  return out
}

/** The internal path a hash maps to, given the compiled route table. */
export function hashToPath(
  patterns: HashPattern[],
  hash: string,
): { path: string; pattern: HashPattern } | null {
  const clean = normaliseHash(hash)
  for (const compiled of patterns) {
    const params = matchPattern(compiled, clean)
    if (!params) continue
    let path = compiled.path
    for (const name of compiled.params) {
      path = path.replace(
        new RegExp(':' + name + '(?![A-Za-z0-9_])'),
        encodeURIComponent(params[name] ?? ''),
      )
    }
    return { path, pattern: compiled }
  }
  return null
}

/**
 * Strip the leading `#` and any leading slash.
 *
 * The slash is tolerated on input but never produced on output: a URL someone
 * hand-edited to `#/characters?all` should still work.
 */
export function normaliseHash(hash: string): string {
  let out = hash || ''
  if (out.startsWith('#')) out = out.slice(1)
  if (out.startsWith('/')) out = out.slice(1)
  return out
}
