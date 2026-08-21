# Running Yorick on your phone, over Tailscale, with a database that survives

A dev environment you can open on a phone — or any device on your tailnet —
backed by a real MongoDB that keeps its data between restarts. Nothing is
exposed to the public internet, and the E2E suite is entirely unaffected.

    npm run dev:tailnet          # or: node .claude/dev-with-mongo.js
    tailscale serve --bg 41337   # once per machine

Then open `https://<machine>.<tailnet>.ts.net` on the phone. The launcher
prints the exact URL at startup.

---

## Why this needs a runbook at all

Three things in this repo make the naive version fail, each of them quietly.

### 1. The client picks its API server by hostname

`public/scripts/app/siteconfig.js` chooses a config from
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
3. Derives this machine's MagicDNS name from `tailscale status --json` and sets
   `PUBLIC_SERVER_URL` from it.
4. Warns if `tailscale serve` points at some other port.
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

    tailscale serve --bg 41337

This proxies `https://<machine>.<tailnet>.ts.net` to `127.0.0.1:41337`, with a
real certificate. It is **tailnet-only** — not Funnel, so nothing is published
to the public internet.

Two reasons to prefer it over hitting `100.x.y.z:41337` directly:

- Traffic arrives through `tailscaled`, which is already permitted, so Windows
  Firewall never needs an inbound rule for `node`.
- You get HTTPS, which some browser APIs require and which mobile browsers are
  far happier with.

To tear it down:

    tailscale serve --https=443 off

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
- `tailscale serve` forwards exactly one port, the app's.
- It is not on 27017, so `index.js`'s probe never finds it and neither does
  anything else looking in the usual place.

There is no authentication on it, which is fine precisely because nothing can
reach it. If you ever change the bind address, add credentials first.

---

## Verifying it works

    curl -s https://<machine>.<tailnet>.ts.net/parse/1/health \
      -H "X-Parse-Application-Id: APPLICATION_ID"

Expect `{"status":"ok"}`. To confirm the database is actually seeded rather than
merely reachable, log in — an empty database answers this with an error:

    curl -s -X POST https://<machine>.<tailnet>.ts.net/parse/1/login \
      -H "X-Parse-Application-Id: APPLICATION_ID" \
      -H "Content-Type: application/json" \
      -d '{"username":"devuser","password":"thedumbness"}'

Seeded test accounts are listed in `seed_db.js`: `devuser` (admin/storyteller),
`sampmem`, `sampast`, `sampstranger`, `sampprivate`.

---

## Troubleshooting

**502 from the tailnet URL.** Either the app is not running or `tailscale serve`
points at the wrong port. Check with `tailscale serve status`.

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
back over HTTP from `publicServerURL`. If that points at `127.0.0.1` while you
are uploading from a phone, it resolves to the phone and the save is refused —
with an orphaned blob left in GridFS each time. The launcher sets it from the
Tailscale hostname to avoid exactly this.

---

## Relationship to the E2E suite

None, by design. The suite continues to allocate from `BASE_PORT = 1337` and,
finding nothing on 27017, continues to start a private in-memory MongoDB per
worker. Nothing in `e2e/` or `playwright.config.js` was changed to make this
work, and the dev database is never touched by a test run.
