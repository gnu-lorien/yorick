/**
 * Which Parse server to talk to.
 *
 * A faithful port of public/scripts/app/siteconfig.js, including its two
 * non-obvious decisions:
 *
 * 1. Every serverURL carries the "/1" version segment. Parse JS SDK 1.5
 *    appended it itself, so a serverURL of ".../parse" reached the server as
 *    ".../parse/1/classes/X", which is where index.js mounts. Modern SDKs do
 *    not append it, so it is written out. Do not "tidy" it away.
 *
 * 2. localhost and Tailscale hosts are same-origin with the API, so their
 *    serverURL is derived from window.location rather than hard-coded. That is
 *    also why no test in this repo can catch a wrong *deployed* value: the E2E
 *    harness only ever exercises the same-origin branch.
 *
 * The Facebook fields are carried over but unused -- Facebook login was removed
 * during the Parse 8 migration, not migrated (see app/loadall.js).
 *
 * ## Choosing one, at build time
 *
 * The legacy client picks by having the deployed copy of `siteconfig.js`
 * rewritten: `gulp greensboro` runs gulp-replace over its last line. A bundled
 * app has no served file to rewrite, so the same choice arrives as a define --
 * `YORICK_SITE=greensboro` on the build, which `web/vite.config.ts` turns into
 * `__YORICK_SITE__`. Both are the same decision made in the same place: the
 * gulp target that names the deployment.
 *
 * A build with no site named behaves exactly as before, which is what every
 * local build and the E2E harness rely on.
 */

/** Replaced at build time by `web/vite.config.ts`; '' means none was named. */
declare const __YORICK_SITE__: string;

export interface SiteConfig {
  serverURL: string;
  facebookAppId?: string;
  redirect_uri: string;
  SAMPLE_TROUPE_ID?: string;
}

const ConfigPubstorm: SiteConfig = {
  serverURL: 'https://stagingapi.undergroundtheater.org/parse/1',
  facebookAppId: '1606746326305984',
  redirect_uri: 'https://stagingpatron.undergroundtheater.org/index.html',
};

const ConfigPatron: SiteConfig = {
  serverURL: 'https://api.undergroundtheater.org/parse/1',
  facebookAppId: '1606746326305984',
  redirect_uri: 'https://patron.undergroundtheater.org',
};

const ConfigLocalhost: SiteConfig = {
  serverURL: 'http://localhost:1337/parse/1',
  facebookAppId: '1607159299598020',
  redirect_uri: 'http://localhost/index.html',
};

const ConfigC9: SiteConfig = {
  serverURL: 'https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1',
  redirect_uri: 'https://yorick-latest-parse-server-gnu-lorien.c9users.io/index.html',
  SAMPLE_TROUPE_ID: 'mXhRByDNxX',
};

/**
 * The Heroku deployment.
 *
 * Present in the legacy `siteconfig.js` and missed by the first pass of this
 * port, which mattered the moment a build could be pointed at a named site:
 * `gulp heroku` has a target and would have had nothing to select.
 */
const ConfigHeroku: SiteConfig = {
  serverURL: 'https://young-plateau-55863.herokuapp.com/parse/1',
  facebookAppId: '202279720650237',
  redirect_uri: 'https://sheets.ourislandgeorgia.net/index.html',
  SAMPLE_TROUPE_ID: 'mXhRByDNxX',
};

const ConfigGreensboro: SiteConfig = {
  serverURL: 'https://greensboro-yorick.herokuapp.com/parse/1',
  facebookAppId: '202279720650237',
  redirect_uri: 'https://sheets.ourislandgeorgia.net/index.html',
  SAMPLE_TROUPE_ID: 'mXhRByDNxX',
};

/**
 * The site names a build may be pointed at, and what each selects.
 *
 * The keys are the four gulp targets, and they are the contract described in
 * `clients.js`: `YORICK_SITE=greensboro` must reach the same server that
 * `siteconfig-greensboro` gives the legacy client.
 */
export const SITE_CONFIGS: Record<string, SiteConfig> = {
  pubstorm: ConfigPubstorm,
  patron: ConfigPatron,
  heroku: ConfigHeroku,
  greensboro: ConfigGreensboro,
};

/** Unreferenced here, exactly as in the original, but kept for parity. */
export const knownConfigs = { ConfigPubstorm, ConfigPatron, ConfigC9, ConfigGreensboro };

function resolve(): SiteConfig {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    // Tailnet peers are same-origin too, reachable by MagicDNS name or by the
    // raw 100.64.0.0/10 CGNAT address. Both are private by construction, so
    // neither can shadow a deployed host.
    const isTailscale =
      /\.ts\.net$/.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
    if (host === 'localhost' || host === '127.0.0.1' || isTailscale) {
      return { ...ConfigLocalhost, serverURL: `${window.location.origin}/parse/1` };
    }
  }

  // Named at build time, after the same-origin check and before the fallback,
  // which is exactly where the legacy client's `return ConfigX;` sits once gulp
  // has rewritten it. A deployed build reaches this line; a local one does not.
  const named = typeof __YORICK_SITE__ === 'string' ? __YORICK_SITE__ : '';
  if (named) {
    const chosen = SITE_CONFIGS[named];
    if (!chosen) {
      // Loud, because the alternative is silently talking to the dead
      // development host and discovering it as "everything 404s".
      throw new Error(
        `Unknown YORICK_SITE "${named}". Known sites: ${Object.keys(SITE_CONFIGS).join(', ')}.`,
      );
    }
    return chosen;
  }

  return ConfigC9;
}

export const siteconfig: SiteConfig = resolve();

/** The application id, as passed to Parse.initialize in app/loadall.js. */
export const APPLICATION_ID = 'APPLICATION_ID';
export const JAVASCRIPT_KEY = 'yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR';
