# Deploying more than one client

There are three front ends now. The legacy Backbone app, the React port and the
Vue port are the same application against the same server, so a deployment
carries all of them — one at the root, the rest in subdirectories — and you can
open them side by side and compare them on real data. Nothing is swapped out,
and nothing has to be finished before the rest can ship.

```bash
npx gulp patron
```

That builds every front end listed in `build/frontends.js` into `dist/`: the
Backbone app at the root, the React port under `/react/`, the Vue port under
`/vue/`, and a redirect at `/legacy/` pointing back to the root. The four site
names — `pubstorm`, `patron`, `heroku`, `greensboro` — are the gulp targets they
always were, and they reach every front end.

## Where the layout is decided

`build/frontends.js`, and nowhere else. Adding a port is one entry:

```js
{ id: 'svelte', label: 'the Svelte client', build: 'npm run build:svelte' }
```

There is no list of known front ends elsewhere to update and no gulp task to
add. The id is the URL segment and the directory name, so it is validated: it
must be a usable path segment, and it may not be one of the names the root app
writes (`scripts`, `styles`, `images`, `assets`, `fonts`, `templates`). What is
actually on disk is checked too, after the root build, because that list cannot
be exhaustive.

Two flags, both of which exist so that neither answer is baked in:

| | |
| --- | --- |
| `--frontends=react` | build only these, leaving every other front end's files in `dist` untouched |
| `--default=react` | put this one at the root; whoever was there moves to `/<their id>/` |

So the eventual flip — a port at the root and the Backbone app underneath — is
`npx gulp greensboro --default=react`, or a one-word edit to `DEFAULT_FRONTEND_ID`
in `build/frontends.js`. It is not a change to any build config. Both were
measured: with `--default=react`, the React client serves from `/`, the Backbone
app from `/legacy/` and the Vue port stays at `/vue/`. The Backbone app survives
the move because every path in `public/index.html` is relative.

Either flag can also be given as an environment variable —
`YORICK_FRONTENDS`, `YORICK_DEFAULT` (or the older `YORICK_DEFAULT_FRONTEND`) —
for a CI setting that cannot pass argv.

### Every front end also answers at its own path

The default is served at `/` *and* at `/<its id>/`, through a redirect stub
rather than a second copy. That is the point of the alias: a link to `/legacy`
or `/react` keeps meaning the same app after the default changes, instead of
quietly coming to mean "whichever is default now". The stub carries the
fragment, because every route in all three apps is one — `/legacy#troupes` has
to arrive at `/#troupes` or the link lands on the front page.

## What a port's build is given

Four environment variables, and the contract is in `build/frontends.js`:

| | |
| --- | --- |
| `YORICK_BUILD_BASE` | the mount, e.g. `/react/` |
| `YORICK_BUILD_OUT_DIR` | where to write, relative to the repo root; already emptied |
| `YORICK_BUILD_EMPTY_OUT_DIR` | `0` — do not empty it yourself |
| `YORICK_SITE` | which Parse server this build talks to |

A build that ignores them still produces files. It produces files that only work
at the root and only against the development server, which is worth being
concrete about because neither failure looks like a build failure:

- **Ignoring `YORICK_BUILD_BASE`** means asset URLs come out as
  `/assets/index.js`. A client under `/react/` then asks the *root* client for
  its bundle and gets `index.html` back — with a 200 and an HTML content type.
  The console shows a syntax error in what it thought was JavaScript, which is a
  long walk from the cause.
- **Ignoring `YORICK_SITE`** means the deployed client talks to whatever its
  development default is. In this repository that default is a host that shut
  down years ago, so the app loads and then every request fails.
- **Emptying your own output directory** is the one that bites hardest, and it
  is why `YORICK_BUILD_EMPTY_OUT_DIR=0` is part of the contract. The front end
  at the root is handed `dist` itself, and emptying that deletes every other
  front end's subdirectory. Both ports found this independently: with the other
  one promoted to the root, the root build removed the sibling directory the
  pipeline had just written, leaving a deployment with one client in it and no
  error anywhere. `gulp clean` has already cleared what this build owns, and it
  spares the other front ends on purpose.

Both ports honour all four — `web/vite.config.ts` and the root `vite.config.ts`
— and either is a working example to copy. The Vue config translates
`YORICK_SITE` into the `VITE_YORICK_TARGET` its own source reads; the contract
stays one name, and the adapter lives in the port that needs it.

## The site name reaches the ports now

The legacy client picks its Parse server by having its deployed `siteconfig.js`
rewritten — `siteconfig-greensboro` and its three siblings run gulp-replace over
the last line. A bundled app has no served file to rewrite, so the same choice
arrives as a build-time value: for the React port `YORICK_SITE=greensboro`
becomes the `__YORICK_SITE__` define that `web/src/config/siteconfig.ts`
resolves against `SITE_CONFIGS`, and for the Vue port it becomes
`VITE_YORICK_TARGET`, which `client/src/config/siteconfig.ts` resolves against
the same table.

Both are the same decision made in the same place: the gulp target that names
the deployment. An unknown site name throws at startup rather than falling
through to the development host, because "everything 404s" is a bad way to find
out.

Two things this turned up, both now fixed:

- The React port had no `ConfigHeroku`. It was in the legacy `siteconfig.js` and
  missed by the first pass, which did not matter until a build could be pointed
  at a named site — `gulp heroku` would have had nothing to select.
- The portrait fallback was the bare string `head_skull.png`, resolved relative
  to the current page. From `/react/` that is right; from `/react` — no trailing
  slash, an ordinary thing to type — it reaches for the root client's copy.
  `web/src/config/assets.ts` builds it from `BASE_URL` instead.

## What is NOT in here

**No client switcher in the UI.** You reach a port by typing its URL. There is
no link between clients, no chooser page, and no remembered preference — that
was an explicit decision, not an omission, so a deployment carrying three
clients does not change what any of them looks like.

**The clients share an origin, and therefore a session.** Log in to one and you
are logged in to the others, because `Parse.User.current()` is localStorage on
the same origin. That is what makes side-by-side comparison quick, and it is
worth knowing before you conclude that a port has its own session bug.

## The deploy this enables, and the one thing to know first

`dist/` is tracked, and the committed copy is old: it was built from the
`patron` target long before the Parse 8 migration. Netlify serves it.

Rebuilding it is therefore a deploy decision, not a build step. **A rebuilt
`dist/` ships the Parse 8 migration to production**, which production has not
taken — that coupling is recorded in `dependency-vulnerabilities.md` §2, and it
is why the directory was deliberately left stale. The commands above were
verified locally and the tree was restored afterwards; committing a rebuilt
`dist/` is a separate, deliberate act.

## Verifying a build without deploying it

Serve the built directory with the app's own server, which mounts Parse at the
same origin:

```bash
MONGODB_URI=mongodb://127.0.0.1:27317/yorick_react PORT=41502 PUBLIC_BASE="$PWD/dist" node index.js
```

Then `http://localhost:41502/` is the Backbone app, `/react/` and `/vue/` the
two ports, all three against the same local database. The site baked into the
build does not interfere: `siteconfig` checks the hostname first, and localhost
is same-origin with the API — which is also why no test in this repository can
catch a wrong *deployed* server URL. Check that one by eye, in the built file.

`.claude/serve-combined.js` does the same thing with the ports already chosen,
if you would rather not type it.
