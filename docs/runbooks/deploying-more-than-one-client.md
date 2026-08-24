# Deploying more than one client

There is more than one front end now. The legacy Backbone app and each port are
the same application against the same server, so a deployment carries all of
them — one at the root, the rest in subdirectories — and you can open the two
side by side and compare them on real data. Nothing is swapped out, and nothing
has to be finished before the rest can ship.

```bash
npx gulp patron
```

That builds every client listed in `clients.js` into `dist/`: the legacy app at
the root and the React port under `/react/`. The four site names —
`pubstorm`, `patron`, `heroku`, `greensboro` — are the gulp targets they always
were, and they now reach the ports too.

## Where the layout is decided

`clients.js`, and nowhere else. Adding a port is one entry:

```js
{ name: 'vue', mount: '/vue/', command: 'npm run build:vue' }
```

There is no list of known clients elsewhere to update and no gulp task to add.
`mount: '/'` marks the client at the root, and exactly one may claim it.

Two flags, both of which exist so that neither answer is baked in:

| | |
| --- | --- |
| `--clients=react` | build only these, leaving every other client's files in `dist` untouched |
| `--root=react` | put this client at the root; whoever was there moves to `/<their name>/` |

So the eventual flip — a port at the root and the legacy app underneath — is
`npx gulp greensboro --root=react`, or a two-character edit in `clients.js` to
make it the default. It is not a change to any build config. Both were measured:
with `--root=react`, the React client serves from `/` and the legacy app from
`/legacy/`, which works because every path in `public/index.html` is relative.

Either flag can also be given as an environment variable — `YORICK_CLIENTS`,
`YORICK_ROOT` — for a CI setting that cannot pass argv.

## What a port's build is given

Three environment variables, and the contract is in `clients.js`:

| | |
| --- | --- |
| `YORICK_BASE` | the mount, e.g. `/react/` |
| `YORICK_OUT_DIR` | absolute path to write into, already emptied |
| `YORICK_SITE` | which Parse server this build talks to |

A build that ignores them still produces files. It produces files that only work
at the root and only against the development server, which is worth being
concrete about because neither failure looks like a build failure:

- **Ignoring `YORICK_BASE`** means asset URLs come out as `/assets/index.js`. A
  client under `/react/` then asks the *root* client for its bundle and gets
  `index.html` back — with a 200 and an HTML content type. The console shows a
  syntax error in what it thought was JavaScript, which is a long walk from the
  cause.
- **Ignoring `YORICK_SITE`** means the deployed client talks to whatever its
  development default is. In this repository that default is a host that shut
  down years ago, so the app loads and then every request fails.
- **Emptying `YORICK_OUT_DIR` yourself** is the one that bites hardest. A client
  at the root is handed `dist` itself, and emptying that deletes every other
  client's subdirectory. Measured while writing this: `--root=react` built the
  legacy app into `dist/legacy` and Vite then removed it, leaving a deployment
  with one client in it and no error anywhere. `gulp clean` has already cleared
  what this build owns, and it spares the other clients on purpose.

The React port honours all three in `web/vite.config.ts`, and it is the working
example to copy.

## The site name reaches the ports now

The legacy client picks its Parse server by having its deployed `siteconfig.js`
rewritten — `siteconfig-greensboro` and its three siblings run gulp-replace over
the last line. A bundled app has no served file to rewrite, so the same choice
arrives as a define: `YORICK_SITE=greensboro` becomes `__YORICK_SITE__`, which
`web/src/config/siteconfig.ts` resolves against `SITE_CONFIGS`.

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
was an explicit decision, not an omission, so a deployment carrying two clients
does not change what either one looks like.

**The clients share an origin, and therefore a session.** Log in to one and you
are logged in to the other, because `Parse.User.current()` is localStorage on
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

Then `http://localhost:41502/` is one client and `http://localhost:41502/react/`
the other, both against the same local database. The site baked into the build
does not interfere: `siteconfig` checks the hostname first, and localhost is
same-origin with the API — which is also why no test in this repository can
catch a wrong *deployed* server URL. Check that one by eye, in the built file.
