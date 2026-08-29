# Running Yorick on your phone, over Tailscale, with a database that survives

A dev environment you can open on a phone — or any device on your tailnet —
backed by a real MongoDB that keeps its data between restarts. Nothing is
exposed to the public internet, and the E2E suite is entirely unaffected.

Once per machine, publish the two dev servers on one https port:

    tailscale serve --bg --https=8443 --set-path=/     http://127.0.0.1:5273
    tailscale serve --bg --https=8443 --set-path=/parse http://127.0.0.1:41337/parse

Then, per session:

    npm run dev:tailnet     # app + mongo  (or: node .claude/dev-with-mongo.js)
    YORICK_SERVE_PORT=8443 npm run dev:vue

Or run the `Dev: Full stack (app + Vue client)` task in the editor, which does
both. Open `https://<machine>.<tailnet>.ts.net:8443` on the phone; the launcher
prints the exact URL at startup.

**Why 8443 and not 443.** `tailscale serve` publishes on whatever https port it
is given, and on a machine that already serves something at `/` on 443 — a web
editor, say — repointing it takes that down. A second port costs nothing and
touches nothing.

**Why both front end and API on one origin.** `siteconfig` recognises a
`.ts.net` hostname and uses `window.location.origin + '/parse/1'` as the API
base, so a single origin means no CORS and no configuration. The `/parse` mount
goes straight to the app rather than through Vite, so uploaded-file URLs keep
working even when the Vue dev server is not running.

---

## Why this needs a runbook at all

Three things in this repo make the naive version fail, each of them quietly.

### 1. The client picks its API server by hostname

Both front ends do this: `public/scripts/app/siteconfig.js` for the legacy
client and `client/src/config/siteconfig.ts` for the Vue one. Each chooses a
config from
`window.location.hostname`. Until recently only `localhost` and `127.0.0.1`
resolved to "same origin as this page"; everything else fell through to
`ConfigGnuLorienDev`, which points at a Cloud9 host that stopped existing years
ago.

A phone opening the app over the tailnet would therefore load the UI perfectly,
render the login page, and fail every single API call — with nothing on screen
explaining why. `siteconfig.js` now also treats Tailscale hostnames as
same-origin:

- MagicDNS names, `*.ts.net`
- the CGNAT range Tailscale allocates from, `100.64.0.0/10`

Both are private by construction — `.ts.net` names resolve only through the
tailnet's own DNS, and `100.64/10` is not routable on the public internet — so
neither can ever match a deployed host. The four deployed configs are untouched.

This is also why the tailnet URL puts the app and the API on **one origin**: the
same-origin branch is the only one that resolves to a working backend, so any
layout that splits them across two ports has to be configured by hand instead.

### 2. A real database is never seeded automatically

`seedingAllowed()` in `seed_db.js` permits seeding only on `force: true`,
`ephemeral: true`, or `YORICK_ALLOW_SEED=1`. The in-memory MongoDB that
`index.js` normally starts qualifies as `ephemeral`. **A real one does not.**

This does not fail loudly. The server boots, reports healthy, serves the login
page — and the database is empty. No clans, no disciplines, no descriptions, no
accounts. The only trace is one `[seed] Skipped.` line in the log.

The gate is deliberate: `seedTestUsers` runs on *every* boot, and would
otherwise upsert `devuser` — an administrator whose password is published in
this repository — into whatever database it was pointed at.

So a new database has to be seeded once, explicitly:

    MONGODB_URI=mongodb://127.0.0.1:27117/yorick_dev npm run seed

The launcher detects an empty dbpath and prints this command rather than
running it for you.

### 3. Two default ports belong to the E2E suite

Both defaults you would reach for are already claimed:

| Port | Claimed by |
|---|---|
| `1337`–`1344` | `e2e/ports.js`: `BASE_PORT = 1337`, one port per Playwright worker |
| `27017` | `index.js` probes it; anything listening there captures every worker |

The second is the dangerous one. When the 27017 probe hits, every worker
abandons its private in-memory MongoDB and shares whatever is listening,
isolated only by database name (`anotherstore_w0`, `_w1`, …). Within a single
run that holds. Across runs it does not: there is no `globalTeardown`, nothing
in the harness drops those databases, and `seed_db.js` loads bulk seed data
only into an *empty* database. Run two would therefore skip reseeding and
inherit every mutation run one made — reintroducing exactly the cross-suite
contamination that per-worker backends were built to eliminate, and presenting
as "flaky on my machine."

Hence **41337** for the app and **27117** for the database. Leave 1337–1344 and
27017 to the suite.

---

## What the launcher does

`.claude/dev-with-mongo.js`, wired up by `.claude/launch.json`:

1. Starts `mongod` on `127.0.0.1:27117` with a persistent dbpath, or reuses one
   already listening there.
2. Waits for it to accept connections.
3. Reads `tailscale serve status`, finds the mapping that actually reaches the
   app's port, and sets `PUBLIC_SERVER_URL` from it — origin *and* https port.
4. Warns, with the command to fix it, if no mapping reaches the app.
5. Starts `index.js` with `MONGODB_URI` pointed at the persistent database.
6. On exit, stops the `mongod` **it started** — never one it merely found.

### Defaults, and how to override them

| Setting | Default | Override |
|---|---|---|
| App port | `41337` | `PORT` |
| Mongo port | `27117` | `YORICK_DEV_MONGO_PORT` |
| Database name | `yorick_dev` | `YORICK_DEV_DB` |
| Data directory | `~/.yorick-dev-mongo/data` | `YORICK_DEV_DBPATH` |
| `mongod` binary | highest in `~/.cache/mongodb-binaries`, else `mongod` on PATH | `YORICK_DEV_MONGOD` |
| Public origin | derived from Tailscale | `PUBLIC_SERVER_URL` |

**No MongoDB install is required.** `mongodb-memory-server` caches real `mongod`
builds under `~/.cache/mongodb-binaries` as a side effect of every E2E run, and
the launcher reuses the newest one it finds.

The data directory lives outside the repo on purpose: a dbpath inside a worktree
is one `git clean -xdf` away from deletion.

---

## Exposing it to the tailnet

    tailscale serve --bg --https=8443 --set-path=/     http://127.0.0.1:5273
    tailscale serve --bg --https=8443 --set-path=/parse http://127.0.0.1:41337/parse

This proxies `https://<machine>.<tailnet>.ts.net:8443` to the two dev servers
with a real certificate. It is **tailnet-only** — not Funnel, so nothing is
published to the public internet.

Two reasons to prefer it over hitting `100.x.y.z:41337` directly:

- Traffic arrives through `tailscaled`, which is already permitted, so Windows
  Firewall never needs an inbound rule for `node`.
- You get HTTPS, which some browser APIs require and which mobile browsers are
  far happier with.

To tear it down:

    tailscale serve --https=8443 off

### The mount path and the target path have to agree

Tailscale strips the mount path and appends what is left to the target's *own*
path. `--set-path=/parse` onto `http://127.0.0.1:41337/parse` is therefore the
identity, and `/parse/1/health` arrives as `/parse/1/health`. Drop the `/parse`
from the target and the app is handed `/1/health` instead, and 404s the entire
API. The launcher checks the two agree before trusting a mapping.

### Vite needs two things to sit behind this

Set in `vite.config.ts`, so a plain `npm run dev:vue` is unchanged:

- `allowedHosts: ['.ts.net']`. Vite rejects a `Host` header it was not told
  about with "Blocked request" — a blank page, reason only in the terminal.
- `host: '127.0.0.1'`. Vite's default is the *name* `localhost`, and Node binds
  the single address that resolves to. Land on `::1` and the proxy, which dials
  literal `127.0.0.1`, gets a bare 502 while Vite reports itself ready.

And `YORICK_SERVE_PORT=8443` in the environment, which is what the
`Dev: Vue client` task sets. Without it Vite tells its HMR client to dial port
5273, which is not exposed, and hot reload silently stops working — edits show
up only on a manual refresh.

### The serve mapping outlives the app

A `--bg` mapping persists after the process it pointed at is gone. Change the
app's port without repointing it and the tailnet URL answers **502 forever**,
which reads as the app being broken rather than the proxy being stale. The
launcher checks for this at startup and warns; it does not rewrite the config,
because how this machine is reachable from other people's devices is an
operator decision.

---

## The database is reachable only from this machine

- It binds `127.0.0.1`, not `0.0.0.0` — a connection to `<tailscale-ip>:27117`
  is refused.
- `tailscale serve` forwards two ports, the app's and the Vue dev server's.
- It is not on 27017, so `index.js`'s probe never finds it and neither does
  anything else looking in the usual place.

There is no authentication on it, which is fine precisely because nothing can
reach it. If you ever change the bind address, add credentials first.

---

## Verifying it works

    curl -s https://<machine>.<tailnet>.ts.net:8443/parse/1/health \
      -H "X-Parse-Application-Id: APPLICATION_ID"

Expect `{"status":"ok"}`. To confirm the database is actually seeded rather than
merely reachable, log in — an empty database answers this with an error:

    curl -s -X POST https://<machine>.<tailnet>.ts.net:8443/parse/1/login \
      -H "X-Parse-Application-Id: APPLICATION_ID" \
      -H "Content-Type: application/json" \
      -d '{"username":"devuser","password":"thedumbness"}'

Seeded test accounts are listed in `seed_db.js`: `devuser` (admin/storyteller),
`sampmem`, `sampast`, `sampstranger`, `sampprivate`.

### Verifying portrait uploads specifically

This is the one thing a reachable app can still get wrong, so check it directly
rather than inferring it. Upload a file and fetch the URL the server hands back
— that URL is the one `cloud/main.js` will read from:

    curl -s -X POST --data-binary @test_character_picture.jpg \
      -H "X-Parse-Application-Id: APPLICATION_ID" \
      -H "X-Parse-Master-Key: MASTER_KEY" \
      -H "Content-Type: image/jpeg" \
      http://127.0.0.1:41337/parse/1/files/portrait.jpg

    curl -sI "<the url from the response>"

The response URL must carry the tailnet host **and the `:8443`**, and the fetch
must come back `Content-Type: image/jpeg`. Anything HTML means the URL resolves
to something that is not this app, and every portrait save will fail with
`Could not find MIME for Buffer`. Clean up after yourself:

    curl -X DELETE -H "X-Parse-Application-Id: APPLICATION_ID" \
      -H "X-Parse-Master-Key: MASTER_KEY" \
      http://127.0.0.1:41337/parse/1/files/<name from the response>

---

## Troubleshooting

**502 from the tailnet URL.** Nothing is listening where `tailscale serve` is
dialling. Check with `tailscale serve status`, then check the target is up *on
the address in that mapping* -- a dev server bound to `::1` refuses a
`127.0.0.1` connection while looking perfectly healthy in its own terminal.

**The app loads but every API call fails.** The hostname is not being recognised
as same-origin. Check what `siteconfig.js` resolves to for your hostname — if
you are reaching the machine by some name other than MagicDNS or a `100.64/10`
address, it will fall through to the dead Cloud9 config.

**The app works but has no game data.** The database was never seeded. See §2.

**Port bind fails with nothing obviously listening.** On a machine whose Windows
dynamic port range has been widened to cover the whole range (check with
`netsh int ipv4 show dynamicport tcp` — the default start is 49152), any
outbound socket can be handed any port. Reserve the port instead of hunting for
a culprit, from an elevated prompt while it is free:

    netsh int ipv4 add excludedportrange protocol=tcp startport=41337 numberofports=1 store=persistent

**Portrait uploads are refused.** `cloud/main.js` reads each uploaded portrait
back over HTTP from `publicServerURL`, so that URL has to reach *this app* from
this machine. Two ways it does not:

- Left at the `127.0.0.1` default, it resolves to the phone you are uploading
  from, and the save is refused — with an orphaned blob left in GridFS each
  time.
- Assembled from the hostname alone, as `https://<machine>.<tailnet>.ts.net`, it
  lands on whatever holds `/` on port 443 — here, the editor. That URL resolves,
  answers `200`, and returns HTML; Jimp is handed a web page and the upload dies
  with **`Could not find MIME for Buffer`**. A URL that answers is not a URL
  that is right.

The launcher reads the mapping out of `tailscale serve status` rather than
predicting it, which is what keeps the second case from coming back. Run the
portrait check above to confirm.

---

## Relationship to the E2E suite

None, by design. The suite continues to allocate from `BASE_PORT = 1337` and,
finding nothing on 27017, continues to start a private in-memory MongoDB per
worker. Nothing in `e2e/` or `playwright.config.js` was changed to make this
work, and the dev database is never touched by a test run.
