/**
 * Per-environment API configuration.
 *
 * A direct port of `public/scripts/app/siteconfig.js`, including its comments,
 * because every value in here is load-bearing and none of it is covered by a
 * test -- the E2E harness serves the app from the same origin as the API, so
 * only the localhost branch is ever exercised.
 *
 * What changed in the port: the AMD module returned one config object chosen at
 * load time, and the gulp build swapped the final `return` statement with
 * `gulp-replace` to select a deployment. Vite has no equivalent of editing a
 * source file mid-build, so the selection is a build-time env var
 * (`VITE_YORICK_TARGET`) resolved against the same table. `npm run build:patron`
 * and friends set it; the default is unchanged behaviour for a dev checkout.
 */

export interface SiteConfig {
  serverURL: string
  facebookAppId?: string
  redirect_uri: string
  SAMPLE_TROUPE_ID?: string
}

const ConfigPubstorm: SiteConfig = {
  serverURL: 'https://stagingapi.undergroundtheater.org/parse/1',
  facebookAppId: '1606746326305984',
  redirect_uri: 'https://stagingpatron.undergroundtheater.org/index.html',
}

const ConfigPatron: SiteConfig = {
  serverURL: 'https://api.undergroundtheater.org/parse/1',
  facebookAppId: '1606746326305984',
  redirect_uri: 'https://patron.undergroundtheater.org',
}

const ConfigLocalhost: SiteConfig = {
  serverURL: 'http://localhost:1337/parse/1',
  facebookAppId: '1607159299598020',
  redirect_uri: 'http://localhost/index.html',
}

const ConfigC9: SiteConfig = {
  serverURL: 'https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1',
  redirect_uri: 'https://yorick-latest-parse-server-gnu-lorien.c9users.io/index.html',
  SAMPLE_TROUPE_ID: 'mXhRByDNxX',
}

const ConfigHeroku: SiteConfig = {
  serverURL: 'https://young-plateau-55863.herokuapp.com/parse/1',
  facebookAppId: '202279720650237',
  redirect_uri: 'https://sheets.ourislandgeorgia.net/index.html',
  SAMPLE_TROUPE_ID: 'mXhRByDNxX',
}

/**
 * Ported from the greensboro branch, which is what the live deploy builds
 * from. That branch's own copy of this file predates the fix described below
 * and says ".../parse" with no version segment, so this value is deliberately
 * NOT byte-identical to its source -- carried over verbatim it would 404 every
 * API call against a modern SDK. The port is one-way: never sync this entry
 * back the other way without the same adjustment.
 */
const ConfigGreensboro: SiteConfig = {
  serverURL: 'https://greensboro-yorick.herokuapp.com/parse/1',
  facebookAppId: '202279720650237',
  redirect_uri: 'https://sheets.ourislandgeorgia.net/index.html',
  SAMPLE_TROUPE_ID: 'mXhRByDNxX',
}

const TARGETS: Record<string, SiteConfig> = {
  pubstorm: ConfigPubstorm,
  staging: ConfigPubstorm,
  patron: ConfigPatron,
  heroku: ConfigHeroku,
  greensboro: ConfigGreensboro,
  c9: ConfigC9,
  localhost: ConfigLocalhost,
}

/**
 * The "/1" is not decoration.
 *
 * Parse JS SDK 1.5 hard-coded the API version segment onto whatever serverURL
 * it was given -- `url += "1/" + route` in parse-1.5.0.js -- so a serverURL of
 * ".../parse" reached the server as ".../parse/1/classes/X", which is where
 * index.js mounts (mountPath "/parse/1"). Modern SDKs do no such thing and
 * request ".../parse/classes/X", which 404s.
 *
 * Every serverURL above carries it explicitly. Owner decision, 2026-08-20: move
 * the config to match the server, rather than remounting the server at "/parse"
 * to match the config. Both fix it and doing BOTH breaks it again; this
 * direction leaves index.js's mount, every stored file URL and every external
 * link where they already are.
 *
 * Only the localhost value is overridden below, because the E2E harness serves
 * the app from the same origin as the API -- which is also why no test in this
 * repo can catch any of the deployed values being wrong.
 */
function resolve(): SiteConfig {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname
    /*
     * Tailscale hosts are same-origin too.
     *
     * Anything that is not localhost falls through to the build target, which
     * for a plain dev build is the dead c9users.io host -- so a phone opening
     * this app over the tailnet would load the UI fine and then fail every API
     * call, with nothing on screen to say why.
     *
     * Two forms, because a tailnet peer is reachable by either: the MagicDNS
     * name (<machine>.<tailnet>.ts.net) and the raw address out of the
     * 100.64.0.0/10 CGNAT range Tailscale allocates from. Both are private by
     * construction -- .ts.net names resolve only through the tailnet's own DNS,
     * and 100.64/10 is not routable on the public internet -- so neither can
     * match a deployed host. The configs above are untouched.
     */
    const isTailscale =
      /\.ts\.net$/.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
    if (host === 'localhost' || host === '127.0.0.1' || isTailscale) {
      return { ...ConfigLocalhost, serverURL: window.location.origin + '/parse/1' }
    }
  }

  const target = import.meta.env?.VITE_YORICK_TARGET as string | undefined
  return (target && TARGETS[target]) || ConfigC9
}

const siteconfig: SiteConfig = resolve()

export default siteconfig
