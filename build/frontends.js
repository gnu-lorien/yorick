/**
 * Which front ends exist, where each one is mounted, and which is served at `/`.
 *
 * There is more than one front end now and there are three of them. This is the
 * single place that knows about them: the gulpfile asks for a layout and builds
 * whatever it is handed, so adding a fourth means adding an entry here and
 * nothing else.
 *
 * ## The layout
 *
 * One front end is the DEFAULT and its files sit at the root of the output, so
 * `/` serves it with no redirect. Every front end -- including the default --
 * also answers at a path of its own:
 *
 *     dist/            the default front end
 *     dist/legacy/     a redirect to `/`        (when legacy is the default)
 *     dist/react/      the React client
 *     dist/vue/        the Vue client
 *
 * The alias for the default is a stub rather than a second copy, so nothing is
 * built or shipped twice. The point of it is that `/vue` and `/legacy` mean the
 * same thing for ever: a link someone sends keeps working after the default
 * changes, instead of silently coming to mean "whichever is default now".
 *
 * ## Choosing the default
 *
 * `--default=react` on the gulp command line, or `YORICK_DEFAULT_FRONTEND`,
 * falling back to `defaultId` below. It is a value in a table rather than a
 * branch in the pipeline, which is what makes swapping it a one-word change and
 * not a rewrite:
 *
 *     npx gulp greensboro --default=react
 *
 * ## Building one front end without disturbing the others
 *
 * `--frontends=vue` narrows the build. The rest of `dist/` is left exactly as
 * it was, which is what makes it possible to rebuild one port against a
 * deployment tree rather than rebuilding all three.
 *
 * ## What a front end's build command is given
 *
 * | | |
 * | --- | --- |
 * | `YORICK_BUILD_BASE` | the mount, e.g. `/react/`. Asset URLs must be built against it, or a client under a subdirectory asks for its bundle at the root and gets the ROOT client's index.html back -- a 200 with an HTML content type, so the failure is a syntax error in the console rather than a 404. |
 * | `YORICK_BUILD_OUT_DIR` | where to write, relative to the repo root. Already emptied by `gulp clean`. |
 * | `YORICK_BUILD_EMPTY_OUT_DIR` | `0`. The build must NOT empty its own output: the default front end is handed the whole tree, and emptying that deletes every other front end. Measured, and silent. |
 * | `YORICK_SITE` | which Parse server this build talks to, one of the four gulp target names. The legacy client resolves the same choice through gulp-replace on `siteconfig.js`. |
 *
 * A build that ignores them still produces files; it produces files that only
 * work at the root and only against the development server. Honour all four.
 *
 * ## Deliberately not here
 *
 * Runtime selection. The owner's call: the URLs are the switch, so `/` serves
 * the build-time default and nothing in the deployed site changes it. The shape
 * below does not preclude adding it later -- a chooser would be one more entry
 * with no build -- but nothing is written for it now, because unused machinery
 * rots.
 */

'use strict';

const path = require('path');

/**
 * The front ends, in build order.
 *
 * `build` is the command that produces one. `null` means the gulpfile builds it
 * in place with its own task series -- true of `legacy` only, whose build is
 * the twelve-task pipeline that predates all of this and is not worth
 * rewriting into a callback. Anything new should bring a command.
 */
const FRONTENDS = [
  {
    id: 'legacy',
    label: 'the Backbone client',
    build: null,
  },
  {
    id: 'react',
    label: 'the React client',
    build: 'npx vite build --config web/vite.config.ts',
  },
  {
    id: 'vue',
    label: 'the Vue 3 client',
    // `build:vue` type-checks before it bundles, so a type error fails the
    // deploy rather than shipping something quietly wrong.
    build: 'npm run build:vue',
  },
];

/** Used when neither `--default=` nor `YORICK_DEFAULT_FRONTEND` says otherwise. */
const DEFAULT_FRONTEND_ID = 'legacy';

/**
 * Names a front end may not use, because the default front end writes them into
 * the root of the output and a mount directory would collide.
 *
 * Not exhaustive by construction -- it cannot be, since a future front end
 * could emit anything -- so `assertNoCollisions` below checks the real output
 * as well. This list is the cheap half, and it fails before the build rather
 * than after it.
 */
const RESERVED = ['scripts', 'styles', 'images', 'assets', 'fonts', 'templates'];

function validate(frontends, defaultId) {
  const ids = frontends.map((f) => f.id);

  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length) {
    throw new Error(`[frontends] duplicate front-end id(s): ${duplicates.join(', ')}`);
  }

  for (const id of ids) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Error(
        `[frontends] "${id}" is not usable as a URL path segment. Use lower-case ` +
        'letters, digits and hyphens.'
      );
    }
    if (RESERVED.includes(id)) {
      throw new Error(
        `[frontends] "${id}" collides with a directory the root front end writes. ` +
        `Reserved: ${RESERVED.join(', ')}.`
      );
    }
  }

  if (!ids.includes(defaultId)) {
    throw new Error(
      `[frontends] the default front end is "${defaultId}", which is not a known ` +
      `front end. Known: ${ids.join(', ')}.`
    );
  }
}

/**
 * Where each front end is built and what URL prefix its assets are served from.
 *
 * `dir` is a filesystem path relative to the repo root; `base` is a URL prefix
 * with both slashes, the shape Vite wants. `aliasDir` is set only for the
 * default front end, and is where the redirect stub goes.
 *
 * `only` narrows the RESULT, not the layout: every front end still gets its
 * place, and the ones left out are simply absent from what comes back. That
 * distinction is what stops `--frontends=vue` from moving the Vue client to the
 * root because it happens to be the only one being built.
 */
function layout(options) {
  const opts = options || {};
  const frontends = opts.frontends || FRONTENDS;
  const defaultId = opts.defaultId || process.env.YORICK_DEFAULT_FRONTEND || DEFAULT_FRONTEND_ID;
  const outDir = opts.outDir || 'dist';

  validate(frontends, defaultId);

  if (opts.only && opts.only.length) {
    const known = frontends.map((f) => f.id);
    const unknown = opts.only.filter((id) => !known.includes(id));
    if (unknown.length) {
      throw new Error(
        `[frontends] unknown front end(s) ${unknown.join(', ')}. Known: ${known.join(', ')}.`
      );
    }
  }

  return frontends
    .map((frontend) => {
      const isDefault = frontend.id === defaultId;
      return Object.assign({}, frontend, {
        isDefault,
        dir: isDefault ? outDir : path.join(outDir, frontend.id),
        // Always a URL, so always forward slashes -- never path.join here.
        base: isDefault ? '/' : `/${frontend.id}/`,
        mount: isDefault ? '/' : `/${frontend.id}/`,
        aliasDir: isDefault ? path.join(outDir, frontend.id) : null,
      });
    })
    .filter((frontend) => !opts.only || !opts.only.length || opts.only.includes(frontend.id));
}

/**
 * The entry for the front end served at `/`.
 *
 * Undefined when a narrowed build left it out, which callers have to handle:
 * `--frontends=vue` writes no root and no alias, on purpose.
 */
function defaultFrontend(entries) {
  return entries.find((f) => f.isDefault);
}

/**
 * Every mount directory the layout can produce, narrowed or not.
 *
 * `clean` needs this rather than the selected entries: a narrowed build must
 * spare the directories of the front ends it is NOT building, and those are
 * exactly the ones missing from its own list.
 */
function allMountDirs(options) {
  const opts = Object.assign({}, options, { only: null });
  return layout(opts)
    .filter((f) => !f.isDefault)
    .map((f) => f.id);
}

/**
 * Fail if a mount directory would land on top of something the root front end
 * already wrote.
 *
 * `RESERVED` catches the names known today; this catches the rest, by looking
 * at what is actually on disk after the root build. Without it a front end
 * called `styles` would quietly replace the stylesheets and the failure would
 * surface as an unstyled page in a deploy.
 */
function assertNoCollisions(entries, fs, alreadyBuilt) {
  const root = defaultFrontend(entries);
  if (!root) return;
  const built = new Set(alreadyBuilt || []);
  for (const entry of entries) {
    if (entry.isDefault) continue;
    // Its directory existing is not a collision if it is there because we put
    // it there. The legacy pipeline builds in place before this runs, so when
    // legacy is not the default its own mount already exists and is fine.
    if (built.has(entry.id)) continue;
    if (!fs.existsSync(entry.dir)) continue;
    throw new Error(
      `[frontends] "${entry.id}" would be built into ${entry.dir}, which already ` +
      `exists after building ${root.id} into ${root.dir}. Rename the front end.`
    );
  }
}

/**
 * The redirect stub for the default front end's own path.
 *
 * The hash is carried across, and that is the whole reason this is a script and
 * not just a `<meta refresh>`: every route in every one of these apps is a
 * fragment, so `/legacy#character?abc123` has to arrive at `/#character?abc123`
 * or the link lands on the front page instead of the character. `replace`
 * rather than `assign` so the stub does not sit in the back button.
 *
 * The meta refresh and the link are the no-JavaScript fallbacks. They lose the
 * fragment, which is the best a static file can do without script.
 */
function redirectStub(target) {
  const to = target || '/';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting</title>
<link rel="canonical" href="${to}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${to}">
<script>
  // Carry the fragment: every route in this app is one.
  location.replace(${JSON.stringify(to)} + location.hash);
</script>
</head>
<body>
<p>This front end is served at <a href="${to}">${to}</a>.</p>
</body>
</html>
`;
}

module.exports = {
  FRONTENDS,
  DEFAULT_FRONTEND_ID,
  RESERVED,
  layout,
  defaultFrontend,
  allMountDirs,
  assertNoCollisions,
  redirectStub,
};
