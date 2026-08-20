<!--
Produced 2026-08-20, after the bump landed at 5f47dca. Every claim below was
re-verified against this worktree rather than copied from the plan: the commit
log was walked, package.json and node_modules read, the seed schema parsed, the
gate reports and hook-count records opened, gulp-uglify run against the
migrated browser files, and `npm run test:node` executed. Where this document
and docs/runbooks/s10-server-migration-plan.md disagree, this one is later and
was measured; §0 of the plan is superseded by §1 here.

No suite run and no gate run was performed while writing this. Nothing in the
tree was modified.
-->
# S10: post-migration handoff

**The server migration is code-complete and green. It is not deployable.**

parse-server 2.8.4 → 9.10.0, node-side `parse` 1.11.1 → 8.6.0, `mongodb`
3.1.1 → 7.1.0, `jimp` 0.2.28 → 0.22.12 all landed, and the full E2E gate
reproduces the pre-migration baseline exactly: 448 expected / 0 unexpected /
3 skipped, against `runs/s10-baseA.json`'s 448 / 0 / 3.

What stands between that and a deploy is five owner decisions and three things
that will break production silently if nobody does them first. **Two of those
three are new and are not in the plan's Phase V list.** They are §3's blockers
I, J and M. Read §3 before scheduling anything.

---

## 1. Steps 1-13: the true status

Verified against the commit log and the tree, not against the plan's §0.

| Step | Status | Landed at | Evidence checked here |
|---|---|---|---|
| 1. Gate wrapper | **done** | (pre-`0b271b1` lineage) | `gate.js` present, 71 KB, `test/gate.test.js` in `npm run test:node` |
| 2. S10 baseline + quarantine | **done** | `512b484`, `96e8806` | `runs/s10-baseA.json` tracked in git: `expected 448, unexpected 0, skipped 3, flaky 0` |
| 3. Log oracle | **done** | `9389ad1` | `hook-counts.js` present; `--diff` run read-only here, exit 0 |
| 4. PaymentPaypal decision | **answered by owner** | — | LIVE. Ported, not deleted. See §4.1 |
| 5. MongoDB 8.2.6 alone | **answered — impossible on the old driver** | — | `mongodb-8-op-query.md`; superseded by Step 13, see §6.9 |
| 6. Before-trigger seam + conversions | **done** | `9d374af`..`10279f2` | seven slices; six gates exit 0, `174d795` exit **3** cleared by the targeted re-run |
| 7. Deletions | **done, minus two files** | `5347818`, `d184949`, `aef66e3` | `server.js` and `c9-parse-server.js` are **still in the tree**; `cors` still in `package.json`. See §6.11 |
| 8. Master-key role reads | **done** | `dcdff91` | server-side only; the browser-side copy is untouched and is now load-bearing — see blocker M |
| 9. Explicit security options | **done, minus one** | `fbccc99`, `e5fe9b7` | `allowClientClassCreation`, `verbose`, `fileUpload`, `enableSanitizedErrorResponse` all pinned. **`enforcePrivateUsers` was never set** — blocker M |
| 10. Seeder/driver decoupling | **done** | `c666b31` | `seed_db.js:4` is `require('mongodb').ObjectId`; `bcryptjs` a direct dependency |
| 11. Lockfile | **done** | `d6eed08` | lock v3; 0 moved / 0 added / 43 removed |
| 12. jimp | **done** | `b7ddac7` | gate 0; `portrait-pipeline-jimp.md` §7 |
| 13a. `.fail` → `.catch` | **done** | `118b6ff` | gate 0, on the legacy stack |
| 13b. `Parse.Promise` → native | **done** | `d67a801` | gate 0, on the legacy stack |
| 13c. `afterSave("SimpleTrait")` | **done** | `fa6d0a4` | gate 0 + hook-counts |
| 13d. delete the dead servers | **NOT DONE — deliberately skipped** | — | flagged NEEDS OWNER; see §6.11 |
| 13e. **the bump** | **done** | `5f47dca` | gate `s10-step13e-3` exit 0 |

Two corrections to the plan's own bookkeeping, for the record:

- **Step 7 is not complete.** `5347818` executed its deletion list for
  `my-parse-server.js` only. `server.js` and `c9-parse-server.js` survive, and
  `c9-parse-server.js:23` still calls `.fail(` — an API that no longer exists
  on the installed SDK. That file is now not merely dead, it is *broken*.
- **Step 9 is one option short.** The plan's Step 9 says "`enforcePrivateUsers`
  — set it, and decide which way, in the same commit as Step 8." It was never
  set, and 9.10.0 defaults it **`true`** (`Options/Definitions.js:265-269`).
  That is a live behaviour change riding in on this bump. Blocker M.

### The bump, in one paragraph

`5f47dca` moved eight files. `mongodb` went to **7.1.0** — parse-server
9.10.0's own exact pin, not the newest — because `mongodb-memory-server-core`
wants `^7.2.0` and the two cannot dedupe; pinning the root at parse-server's
version is what puts the modern driver in the hoist slot where `seed_db.js` and
`audit_db_permissions.js` load it. Verified here: `npm ls mongodb` reports one
root `7.1.0`, `parse-server@9.10.0 -> deduped`, and a separate nested `7.5.0`
under `mongodb-memory-server-core` (dev-only; **that is expected, not a dedupe
failure**). No seeder or auditor call site changed. `index.js` now does
`await api.start()` then `app.use(settings.mountPath, api.app)`. Four defects
the gate found are described in the commit message and are not repeated here.

---

## 2. What the oracles said

| oracle | result |
|---|---|
| `gate.js --name s10-step13e-3 --baseline runs/s10-baseA.json` | **exit 0** — 448 expected / 0 unexpected / 3 skipped / 0 flaky; both quarantined tests passed inline |
| `hook-counts --diff runs/hooks-s10-step12-jimp.json runs/hooks-s10-step13e.json` | **exit 0** — 0 VANISHED, 0 DROPPED, 0 new-fail, 13 steady, 6 rose |
| `npm run test:node` | **207 tests: 206 pass, 0 fail, 1 by-design skip** (re-run while writing this, 454 ms) |
| `npm run audit-permissions` | 31 PASSED, 0 WARNINGS, 0 ERRORS — identical to `fbccc99`'s before-picture |

It took three gate runs to get there, and the shape of the first two is worth
keeping: `s10-step13e` was 8 same-pass / 45 NEW-FAIL / 398 skipped — **one**
defect (the missing `count` CLP) presenting as near-total collapse.
`s10-step13e-2` was 349 / 6 / 95. Do not read a large NEW-FAIL count as a large
number of problems.

### The hook table, before and after

`runs/hooks-s10-step12-jimp.json` → `runs/hooks-s10-step13e.json`, ok/failed:

| hook | before | after | | hook | before | after |
|---|---|---|---|---|---|---|
| `Vampire/beforeSave` | 986/**1** | 987/**0** | | `Patronage/afterSave` | 7/0 | **14**/0 |
| `SimpleTrait/beforeSave` | 865/0 | 865/0 | | `CharacterPortrait/beforeSave` | 2/**1** | 2/**1** |
| `SimpleTrait/afterSave` | 865/0 | **1730**/0 | | `TroupePortrait/beforeSave` | 2/0 | 4/0 |
| `SimpleTrait/beforeDelete` | 516/0 | 570/0 | | `VampireApproval/beforeSave` | 12/**4** | 12/**4** |
| `VampireCreation/beforeSave` | 499/0 | 499/0 | | `fn:get_expected_vampire_ids` | 57/0 | **54**/0 |
| `ExperienceNotation/beforeSave` | 282/0 | 282/0 | | `fn:get_my_patronage_status` | 24/0 | 24/0 |
| `ExperienceNotation/beforeDelete` | 158/0 | 160/0 | | `fn:update_vampire_change_permissions_for` | 10/0 | 10/0 |
| `LongText/beforeSave` | 20/0 | 20/0 | | `fn:change_troupe_staff` | 9/0 | 9/0 |
| | | | | `fn:vote_for_referendum` | 4/**2** | 4/**2** |
| | | | | `fn:get_captured_emails` | 2/0 | 2/0 |
| | | | | `fn:request_password_reset_for` | 1/0 | 1/0 |

Three cells need explaining, and a future session will otherwise re-derive all
three:

1. **`SimpleTrait/afterSave` 865 → 1730 and `Patronage/afterSave` 7 → 14 are
   exactly doubled, and it is logging, not work.** parse-server 9 records every
   afterSave twice — once on entry (`triggers.js:840`) and once on settlement
   (`:817`) — verified as identical consecutive records for one event. Halve any
   afterSave figure before comparing it to a pre-bump number.
2. **`Vampire/beforeSave` failed 1 → 0 is not a hook that stopped refusing.**
   parse-server 9 validates the CLP *before* running the trigger
   (`RestWrite.js:210-227`); 2.8.4 ran the trigger first. The anonymous-create
   probe is still refused, one layer earlier, so the refusal no longer appears
   in the trigger log. **This is the one legitimate way a `failed` column may
   fall, and it is now the standing explanation for that class of change — do
   not accept it a second time without checking which layer refused.**
3. **`fn:get_expected_vampire_ids` 57 → 54 is a real, unexplained, sub-threshold
   fall.** `hook-counts.js` forgives it (its rule is ≥3 fewer *and* ≥25% fewer),
   so it counts as steady and the tool exits 0. It is recorded here so nobody
   spends an afternoon rediscovering that the number moved.

---

## 3. Deploy blockers: every one, with current status

**None of this is code work. All of it needs the owner.**

| # | Blocker | Status |
|---|---|---|
| A | The `/1` path segment | **RESOLVED** |
| B | Node engines pin | **RESOLVED** |
| C | `gulp greensboro` does not exist on this lineage | **OPEN — owner** |
| D | Stale committed `dist/` | **OPEN — and worse than recorded** |
| E | `YORICK_ALLOW_SEED` must never reach a dyno | **OPEN — standing rule** |
| F | greensboro is a config donor, never a merge source | **OPEN — standing rule** |
| G | Push the work | **OPEN — 4 commits on no remote** |
| H | `allowClientClassCreation` / production's 29th class | **RETIRED by owner decision** |
| **I** | **Production's `_SCHEMA` has no `count` action** | **OPEN — NEW, and it takes the whole admin surface down** |
| **J** | **`DB_URI` vs `MONGODB_URI`** | **OPEN — NEW, fails silently into an empty seeded database** |
| **K** | **`publicServerURL` still defaults to a dead Cloud9 host** | **OPEN — NEW** |
| **L** | **No mail adapter: password reset sends nothing** | **OPEN — NEW** |
| **M** | **`enforcePrivateUsers` shipped inherited, not pinned** | **OPEN — NEW, slow-onset** |
| — | The unapplied production CLP remediation | **OPEN, and independent of all of this** |

### A — the `/1` path segment. RESOLVED, with one new trap.

`e5fe9b7` appended `/1` to all six `serverURL` values in
`public/scripts/app/siteconfig.js` (lines 6, 12, 18, 24, 31, 37), and
`index.js` still mounts at `/parse/1`. Verified: every one now reads
`.../parse/1`, and the localhost override at `:64` builds
`window.location.origin + "/parse/1"`.

**The new trap:** `MOUNT_PATH` used to be inert. `index.js:180` hardcoded
`'/parse/1'` and ignored `settings.mountPath`, so setting the env var moved
nothing. `5f47dca` made the mount read the setting. **Setting `MOUNT_PATH` on a
dyno now really moves the mount, and every one of those six client URLs would
404.** Do not set it. If someone ever wants `/parse`, both halves move together
or neither does.

### B — the Node engines pin. RESOLVED.

`package.json` declares
`"node": ">=20.19.0 <21.0.0 || >=22.13.0 <23.0.0 || >=24.11.0 <25.0.0"` —
parse-server 9.10.0's own range. `.travis.yml` pins `20.19` and `22`, both
inside it. This machine is v24.11.1.

**greensboro still declares `"node": "14.x", "npm": "6.x"`.** That value is part
of the config-donor set in blocker F and it is the one field that must **not**
be ported. Porting it would refuse the install outright.

### C — `gulp greensboro` does not exist on this lineage. OPEN.

Verified both sides. This branch's `gulpfile.js` defines `pubstorm`, `patron`
and `heroku` only, and `siteconfig.js` has no `ConfigGreensboro`. The
`greensboro` branch has `siteconfig-greensboro` (`gulpfile.js:88`) and the
`greensboro` composite task (`:118`), plus `ConfigGreensboro` at
`siteconfig.js:31`. If `gulp greensboro` is Netlify's build command, a deploy
from this branch errors immediately.

**When porting it, the serverURL must change.** greensboro's own value is
`https://greensboro-yorick.herokuapp.com/parse` — no `/1`, because it predates
blocker A's fix. Copied verbatim onto this branch it would 404 every API call.
It must be ported as `https://greensboro-yorick.herokuapp.com/parse/1`.

Also unresolved and still an owner question: **which Heroku app is live.**
greensboro's default export is `ConfigGnuLorienDev = ConfigAfterTwilight`
(`after-twilight-yorick`), the gulp task named for the branch emits
`greensboro-yorick`, and `production-clp-remediation.md` restarts
`greensboro-yorick`. The repo cannot settle it.

### D — the stale committed `dist/`. OPEN, and it cannot currently be rebuilt.

470 files tracked, last touched `14ccc39`, **2021-08-21**. Its `app.js` still
maps `parse` to `parse-1.5.0`, `dist/scripts/lib/` contains `parse-1.5.0.js`
and no `parse-8.6.0.js`, and there is no `parse-compat/` directory in it at all.
It cannot run the migrated app. Never treat it as a fallback.

**Measured here, and this converts the plan's "open risk" into a hard blocker:
`gulp <target>` fails today.** `gulp-uglify@1.5.4` resolves to
`uglify-js@2.6.4`, which is ES5-only. Run against every `.js` under `public/`
(159 files, `.min.js` excluded exactly as `minify-js` excludes them), **exactly
one fails**:

```
public/scripts/lib/parse-8.6.0.js
  -> SyntaxError: Unexpected token: operator (>) (line 24, col 27)
```

Line 24 is `var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);`
— an arrow function. All nine `parse-compat/` modules minify cleanly, as does
`Character.js` and the other 148 files. So the fix is narrow, and there are two
cheap ones:

- add `'!./public/scripts/lib/parse-8.6.0.js'` to the `minify-js` glob and copy
  it verbatim in a sibling task; or
- vendor `node_modules/parse/dist/parse.min.js` (the official pre-minified
  build, at exactly the pinned 8.6.0) as `parse-8.6.0.min.js` and point the
  requirejs `parse-sdk` path at it. The unminified bundle is **1.77 MB**, so
  this is worth doing for page weight regardless.

Either way this needs its own commit and a look at the built output, because
nothing in this repo tests `dist/`.

### E — `YORICK_ALLOW_SEED` must never reach a dyno. OPEN, standing rule.

Mechanism verified. `seed_db.js:152` is
`return process.env.YORICK_ALLOW_SEED === '1'`, with narrow passes for
`{force: true}` (the `npm run seed` command) and `{ephemeral: true}` (a
MongoMemoryServer this process created seconds ago). `playwright.config.js:160`
sets it for the harness. Seeding upserts `devuser` — password published in this
repo, `admininterface: true` — matching on `username` alone, so against
production it plants a known-password administrator and overwrites any real
player holding that name. Copy-pasting an env block from the harness config is
exactly how it leaks.

This also fixes the landing direction: **production wiring is ported onto this
branch and deployed from here.** Never the other way.

### F — greensboro is a config donor, never a merge source. OPEN, standing rule.

287 files differ between `origin/greensboro` and HEAD. Merging it would delete
the entire Changeling venue. The port is one-directional and is exactly:
`gulpfile.js`'s `siteconfig-greensboro` + `greensboro` tasks, `ConfigGreensboro`
in `siteconfig.js` (**with `/1` appended** — blocker A), `Procfile` (identical
on both: `web: npm start`), and the `DB_URI` env-var name (**blocker J**).
`engines` is explicitly excluded (blocker B).

### G — push the work. OPEN.

`origin/topic/parse8-migration` is at `b7ddac7`. **The four Step 13 commits —
`118b6ff`, `d67a801`, `fa6d0a4`, `5f47dca` — are on no remote branch at all.**
HEAD is 164 commits ahead of `origin/main`.

`runs/` is gitignored (`.gitignore:117`). Only nine run records are `git add -f`'d;
**every Step 13 gate report and hook-count record exists solely on this disk.**
A botched install that forces a reclone destroys the entire oracle for this step.
Push first, then do anything else.

### I — production's `_SCHEMA` has no `count` action. **NEW. The loud one.**

This is the defect that produced 45 NEW-FAIL on the first gate run, and
production has the identical condition.

**Mechanism, verified in the installed package.** `MongoSchemaCollection.js:91-99`
defines `emptyCLPS`, which carries `count: {}`. `mongoSchemaToParseSchema` at
`:136-141` does `{...emptyCLPS, ...mongoSchema._metadata.class_permissions}`.
So a stored class that has a `class_permissions` object but **no `count` key**
comes back with a present-but-empty `count` rule, and `validatePermission` reads
that as "there is a rule and nobody matches" rather than "there is no rule".
2.8.4 had no separate `count` action at all — `find` governed it.

Fixed in this tree: all **30** classes in `database_seed/_SCHEMA.json` now
declare `count` mirroring `find` exactly. Verified by parsing the file: 30
classes, 0 missing `count`, 0 where `count !== find`.

**Production's `_SCHEMA` predates the count action**, and per
`production-clp-remediation.md` it has 29 entries, **2 of them with no
`class_permissions` key at all**. That split matters:

- a class with **no `class_permissions` key** falls through to `defaultCLPS`
  (`:101-131`), which does carry `count: {'*': true}`. Those two are fine —
  and fully public, which is a separate finding that runbook already owns.
- every class **with** a `class_permissions` object and no `count` key will
  refuse `count` for everybody, including administrators.

**Blast radius, measured.** The app issues exactly four `.count()` calls, and
all four are privilege checks against `_Role`:

- `public/scripts/app/routers/mobileRouter.js:312` — the staff/admin nav gate
- `public/scripts/app/routers/mobileRouter.js:1474` — the admin route gate
- `public/scripts/app/views/AdministrationUserView.js:71` — the admin user list
- `public/scripts/app/views/TroupeEditStaffView.js:81` — the troupe staff editor

If production's `_Role` has a `class_permissions` object without `count`, **the
entire administration surface goes dead for everyone, including admins, on the
first page load after deploy.**

**`audit_db_permissions.js --fix` does not cover this.** Read it: it reconciles
`create` only (`:179-184`), plus a wholesale `EXPECTED_RULE_CLP` replacement for
publicly-writable classes (`:147-150`). The string `count` does not appear in
that file.

**The repair must be driven off production's own `_SCHEMA`, not off this
file.** Production has 29 entries and the seed has 30; which class differs is
still unknown. For every entry that has a `class_permissions` object, copy its
own `find` value to `count`. Something in the shape of
`production-clp-remediation.md`'s Step 4 mongosh loop, over
`_SCHEMA.find({'_metadata.class_permissions': {$exists: true}})`, setting
`_metadata.class_permissions.count = <that document's own find>`. Then
`heroku restart` — parse-server caches the schema in memory and CLP changes do
not take effect on a running dyno.

Verify afterwards by logging in as an administrator and reaching the admin
route. There is no other check; nothing in the suite runs against production.

### J — `DB_URI` vs `MONGODB_URI`. **NEW. Fails silently, into a seeded empty database.**

greensboro's `index.js:15` reads `process.env.DB_URI`. **This lineage's
`getDatabaseURI()` (`index.js:46-89`) reads `process.env.MONGODB_URI` and
nothing else.** The live dyno's config var is almost certainly `DB_URI`.

Deployed as-is, `MONGODB_URI` is unset, so `getDatabaseURI()` probes 127.0.0.1:27017,
finds nothing, and falls to its last branch: **it starts an in-memory
MongoDB on the dyno.** Two outcomes, both bad:

- **`mongodb-memory-server` is a devDependency.** Under a production install
  (`--omit=dev`) the `require` at `index.js:78` throws, `startServer()` rejects,
  and `startServer().catch` calls `process.exit(1)`. Loud — the good case.
- **If devDependencies are present**, it boots. It downloads a mongod binary,
  starts it, and returns `{ephemeral: true}` — which is a **seeding pass**
  (`seed_db.js:151`). The dyno then comes up healthy, serving an empty database
  freshly seeded with `devuser` and the published password, and every real
  player's data is simply absent. The health check passes. Nothing logs an error.

This is the single most dangerous item on the list, because it is the one that
looks like success. **Either rename the config var to `MONGODB_URI` on the
dyno, or add a `DB_URI` fallback to `getDatabaseURI()` — and in either case add
a startup refusal: if `NODE_ENV=production` and no explicit URI was given,
exit rather than starting an in-memory server.**

### K — `publicServerURL` still defaults to a dead Cloud9 host. **NEW.**

`index.js:156` is
`process.env.PUBLIC_SERVER_URL || "https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1"`.
`c9users.io` has not existed for years. `publicServerURL` is what parse-server
bakes into password-reset and email-verification links and into the URLs it
stores on `Parse.File` objects — so an unset `PUBLIC_SERVER_URL` produces
permanently broken reset links and portrait URLs pointing at a dead host, both
of which persist in the database after the mistake is fixed.

`PUBLIC_SERVER_URL` must be set on the dyno, to the live origin **plus the
mount path** (`https://<app>/parse/1`). The harness overrides it per worker
(`playwright.config.js:152`), which is why nothing here catches it.

### L — no mail adapter: password reset silently sends nothing. **NEW.**

`index.js:218-229`: with `MAIL_ADAPTER_MODULE` unset, `settings.emailAdapter` is
`cloud/MemoryEmailAdapter` — it captures outbound mail in memory and sends
nothing, by design, so the suite never mails anyone. On a dyno that means the
correctly-wired password-reset button appears to work and no email ever arrives.
Choosing a provider is a deployment decision with credentials attached; it needs
making before anyone relies on reset. (`package.json` no longer declares any
mail adapter — `parse-server-nodemailer-adapter` was dropped at Step 11 as dead,
correctly; nothing referenced it.)

### M — `enforcePrivateUsers` shipped inherited. **NEW. Slow-onset.**

Step 9 said to set it and decide which way. It was never set, and 9.10.0
defaults it **`true`** (`Options/Definitions.js:265-269`). 2.8.4 had no such
option. So this bump changes the ACL of every user created from now on: new
signups get **no public read**.

**The suite structurally cannot see this.** `seed_db.js:64` writes
`_rperm: ['*', u.id]` straight into Mongo, so every seeded user stays publicly
readable no matter what the option says. And existing production users keep the
ACL they already have — so nothing breaks on day one. It breaks gradually, as
people sign up.

What breaks: every browser-side `_User` read, which is not master-keyed and
cannot be. Confirmed call sites —
`public/scripts/app/models/Troupe.js:27` (`u.query()` over a role's users
relation — the staff roster `TroupeView.js:146` renders) and
`public/scripts/app/views/PatronageView.js:34`, whose owner-picker label is
built from `u.get("username") + u.get("realname") + u.get("email")`. New players
vanish from staff lists and from the patronage owner picker, and under 9.10.0's
default `protectedFields` the `email` half of that label renders `undefined`
for other users even when they are visible.

Note the interaction with Step 8: `dcdff91` master-keyed the *server-side*
`_User`/`_Role` reads in `cloud/Troupe.js`, and the plan already recorded that
this does not close the exposure because `public/scripts/app/models/Troupe.js`
is a browser-side copy of the same module doing the same query from the client.
That was a security note then. With `enforcePrivateUsers` on it becomes a
correctness bug too. **Owner decision: pin it `false` for one release and move
the staff read behind a Cloud function, or accept the breakage and do the Cloud
function now.** Either way, pin it explicitly — an inherited default is a
behaviour that moves under the next bump without appearing in a diff, which is
the reason `allowClientClassCreation`, `fileUpload` and
`enableSanitizedErrorResponse` are all pinned in `index.js` already.

### The CLP remediation is still unapplied.

`docs/runbooks/production-clp-remediation.md` still reads
**"Status: not yet applied to production."** 23 classes publicly writable,
eleven allowing anonymous create/update/delete, measured against the 2026-07-03
dump. It is independent of everything above and needs no upgrade. It is the only
item on this page that is a live vulnerability rather than a migration task, and
it should be done first or alongside — not after.

Its `--fix` and blocker I's `count` repair touch the same documents. Do them in
one maintenance window, with one restart.

### And: `C:/prj/yorick/toimport/`

Holds a 436 MB production dump and `greensboro_master_key.txt`, plus a vim undo
file containing the same key. Gitignored, so this is local-disk exposure, not
repo exposure. **Nothing in S10 needs either file. Agents are told the path
exists so they never read it.** Rotate the key once the CLP work lands.

---

## 4. No oracle: the hand-test list

Everything here can be broken with every suite in this repo green. Ordered by
what it costs to get wrong.

### 4.1 PayPal patron ingestion — do this first, and do it before a payment window

**This is the one path in the entire migration that can lose money silently, and
it always could.** Owner-confirmed 2026-08-20: ingestion is LIVE. Money flows
`POST /deez` → `PaymentPaypal` → `afterSave` → `Patronage`.

Nothing tests any of it. `hook-counts.js` reads
`afterSave("PaymentPaypal")` as zero in every run and always will, because
nothing triggers it — that is not a regression signal, it is the absence of one.

What moved underneath it in this step:

- `index.js:251-270` (`POST /deez`) — its `.fail(` became `.catch(` at `118b6ff`;
  under parse@8 the old form would have been a TypeError inside the IPN callback.
  It depends on a bare global `Parse` (`Parse.Object.extend("PaymentPaypal")`),
  which parse-server 9 still injects — verified, `addParseCloud()` at
  `ParseServer.js:547`. `paypal-ipn@3.0.0` still loads and still exports
  `verify` on node 24 — verified here.
- `cloud/main.js:715-748` (`afterSave("PaymentPaypal")`) — already
  `function(request)`, so no signature change; its `.fail(` also became
  `.catch(`.

**The swallow was preserved deliberately and is still there.** `:746-747`:
a failed `Patronage` save goes to `console.log("...Failed to save patronage ")`
and nothing else. **A payment that fails to become a subscription is silent,
before and after this migration.** Changing that is a product decision, not a
migration edit — but it is worth making, and it is the reason this hand-test
matters more than the others.

**How to test it:** point a PayPal *sandbox* IPN at the deployed `/deez`, with
`item_name` exactly `"Underground Theater Yearly Yorick"`, `payment_status`
`"Completed"`, and `custom` set to a real `_User` objectId. Then confirm three
things, in order, because each failure looks like the next one: (1) a
`PaymentPaypal` row was created; (2) `afterSave` logged
`"afterSave PaymentPaypal Received a paypal payment"`; (3) a `Patronage` row
exists for that user with `expiresOn` one year after `paidOn`. If (1) succeeded
and (3) did not, the swallow at `:746` ate the reason and it is in the dyno's
stdout, not in `parse-server.err`.

Note for whoever does this: production has **both** `PaymentPaypal` and
`Payment_PayPal` classes (both are also in this seed's 30). One is probably
dead. Worth settling while you are in there.

### 4.2 `check_user_password`

Rewritten at `5f47dca` off the dropped `{success, error}` bag. Left alone it
would not have errored — it would have **hung**, because under parse@8 the third
argument to `Parse.User.logIn` is an options bag and neither callback fires, so
`response` is never settled. The only symptom in production would have been a
client timeout.

Hand-verified in this worktree: right password → `true`, wrong password →
`false`, neither hangs. **Re-verify against the deployed backend**, because
the local check ran against an in-memory mongod with seeded users. Log in as a
real account and call it both ways.

### 4.3 The three other registrations nothing ever calls

`hook-counts.js` covers 19 of the 23 registrations in `cloud/`. It can never see
these, and they read as zero forever:

- `make_me_admin` — privilege-relevant, guarded only by `ADMIN_SECRET_KEY`
  (`cloud/main.js:843` region). Untouched by the bump; still worth one call.
- `submit_facebook_profile_data` — Facebook login is deliberately removed;
  this is probably dead and could be deleted after a look.
- `afterSave("PaymentPaypal")` — see 4.1.

### 4.4 Portrait uploads against *existing* production files

2.8.4 stored files through `GridStoreAdapter`. 9.10.0's default is
`GridFSBucketAdapter` — verified: `Controllers/index.js:34` and `:111` wire it,
and `GridStoreAdapter.js` still ships but nothing references it. Both use the
default `fs` bucket, so existing files should stay readable. **The suite proves
nothing about this** — it reseeds a cold database per worker.

Upload a new portrait and open an old one, in production, before announcing the
deploy.

This also closes a §7 unknown that had been open since the plan was written:
**the `filemd5` question is moot.** GridStore issued `filemd5` on every write
and whether modern MongoDB still supports it was listed as load-bearing.
Driver 7.1.0 contains no reference to `filemd5` anywhere in `lib/`, and the
adapter that issued it is no longer wired. If portrait writes were broken in
production by that command's removal, this upgrade fixes them.

### 4.5 Password reset end to end

Blocked on blocker L. Once a mail adapter is configured: request a reset,
confirm the link's host is the live origin and not `c9users.io` (blocker K),
and confirm the link works.

### 4.6 `record_experience_notation`'s detached write

`84462f6` records the design: both `ExperienceNotation` hooks return `undefined`
and the audit write is deliberately never inside the promise parse-server waits
on. What is still genuinely unverified is whether parse-server 9 keeps the
process alive long enough for that detached write to land after the response is
sent. `e2e/xp-history.spec.js` 54-75 covers it and is green — but on an
8-worker local harness, not on a dyno under load. Watch the XP log after deploy.

### 4.7 The Jasmine suite

Still unusable, and still one line from usable. `public/scripts/app/tests/test-main.js:67`
maps `parse: "parse-1.5.0"` while the app maps `parse: "parse-compat/parse"`
(`public/scripts/app.js:44`). As written it would test parse-server 9 through a
2015 client. Repointing it is a one-line change and would give the six
never-called Cloud functions their only oracle. Do not quote its old
pass/fail numbers; they were never reconciled with a static count of the spec
files.

---

## 5. What the suite now proves, and what it does not

The whole stack moved. `runs/s10-baseA.json` was recorded on parse-server 2.8.4
/ parse 1.11.1 / mongodb 3.1.1; `runs/s10-step13e-3.json` was recorded on
9.10.0 / 8.6.0 / 7.1.0. They are the same 448 tests with the same result.

### It proves

- **Behavioural equivalence at the HTTP and UI boundary.** Every assertion the
  448 make — rendered values, error strings, audit-row shapes, redirect
  behaviour — produces the same answer through a wholly different server stack.
  That is a strong statement and it is the one worth making.
- **Every logged registration was reached.** 19 of the 23, via
  `hook-counts.js`: 0 VANISHED, 0 DROPPED, 0 new-fail. A before-trigger record
  is written from inside the settlement callback (`triggers.js`), so a hook
  that silently stopped settling would fall to zero. None did.
- **The `failed` columns held.** `VampireApproval/beforeSave` 12/4,
  `CharacterPortrait/beforeSave` 2/1, `fn:vote_for_referendum` 4/2 — every one a
  negative-path spec still getting the refusal it asked for. A hook that stops
  rejecting is as much a regression as one that stops running, and none did,
  with the single explained exception in §2.
- **The stored schema is interpreted the same way.** `npm run audit-permissions`
  reads identically to `fbccc99`'s before-picture: 31 PASSED, 0 WARNINGS,
  0 ERRORS.
- **The seam's contract.** `npm run test:node`, 207 tests.

### It does not prove

- **Anything about an existing database.** Every worker seeds a cold one. The
  count-CLP failure (blocker I) is the proof of that gap: it was invisible until
  the seed itself was repaired, and production has the same condition with no
  repair. Also unproven: GridStore-era files, existing user ACLs, and every
  schema difference between production's 29 classes and this seed's 30.
- **Any deployed configuration.** `siteconfig.js`'s five non-localhost
  `serverURL` values are never exercised — the harness serves the app from the
  same origin as the API and rewrites `ConfigLocalhost` at `:64`. The built
  `dist/` is never exercised at all.
- **The four registrations nothing calls.** §4.3.
- **The anonymous-write guards.** `require_a_user` guards ten entry points, but
  the only anonymous-write probe in the suite is against `Vampire`, and that is
  masked by the class-level permission — which under parse-server 9 now refuses
  one layer *earlier* than the trigger. If every guard stopped running, the CLPs
  would still refuse and nothing would go red. Direct REST probes with no
  session token would fix this and still do not exist.
- **The two quarantined tests, when they fail.** Test 49 forgives a serial tail
  of 4 (including two authorization tests); test 114 forgives a tail of **14** —
  the entire Parse File surface. Both passed inline on `s10-step13e-3`, so this
  run happens to have full coverage. A future run where they fail is exit 3,
  INCONCLUSIVE, and must be cleared by the targeted re-run the gate prints.
- **Correctness of any hook.** `hook-counts.js` proves *reached*, not *correct*.
  `diff-runs.js` is the correctness oracle and it only sees what a spec asserts.
- **Per-worker attribution.** All eight backends append to one date-named log
  and the trigger lines carry no port, host or pid. Aggregate only — which is
  enough, because a hook that dies under parse-server 9 dies on all eight at once.

### And the honest caveat about "the same 448"

Same-pass across a whole-stack move is not the same evidence as same-pass across
a one-file change. It says the observable behaviour is unchanged; it says
nothing about intermediate representations. The `addUnique` defect fixed in
`5f47dca` is the concrete illustration: the *database* was correct on both
stacks and only the in-memory client object was wrong, and it presented as three
apparently unrelated test failures in three different spec files. Failures at
this layer do not point at their cause.

---

## 6. Things a future session would otherwise rediscover

1. **`npm run test:node` is 207** — 206 pass, 0 fail, 1 by-design skip. The skip
   is "the replica still matches the installed parse-server", which self-skips
   with the message *"parse-server is 9.10.0; the legacy arm of the seam is dead
   and so is this check"*. That is correct behaviour, not a broken test.
2. **`cloud/trigger-compat.js`'s legacy arm is now dead code on the installed
   stack.** It branches on `response === undefined` at call time, and
   parse-server 9 always calls `trigger(request)`. The arm is still fully
   unit-tested and one of its tests is the only thing pinning the
   no-double-settle guarantee. Do not delete it casually; do know it never runs.
3. **parse-server 9 logs every afterSave twice.** `triggers.js:840` on entry and
   `:817` on settlement. Halve any afterSave figure before comparing it across
   the bump. See §2.
4. **A `failed` column falling to zero can mean the CLP moved ahead of the
   trigger**, not that a hook stopped refusing. `RestWrite.js:210-227` in 9 vs
   trigger-first in 2.8.4. See §2.
5. **`fn:get_expected_vampire_ids` 57 → 54** is a real, unexplained,
   sub-threshold fall that `hook-counts.js` forgives. Not damage as far as
   anyone can tell; recorded so it is not rediscovered.
6. **`mongodb` is pinned at 7.1.0 on purpose, not 7.5.0.** It is parse-server
   9.10.0's own exact pin. `mongodb-memory-server-core` wants `^7.2.0` and the
   two therefore cannot dedupe; a nested `mongodb@7.5.0` under
   `mongodb-memory-server-core` is expected and is dev-only. `npm ls mongodb`
   showing one root copy with parse-server deduped onto it is the acceptance
   criterion.
7. **The driver's server-version window is `[4.2, 8.2]`** — read directly from
   `node_modules/mongodb/lib/cmap/wire_protocol/constants.js`. The harness's
   default `4.4.18` and production's 5.0.32 both sit inside it. **The mongod
   version did not move in this step and does not need to.** Re-running the
   8.2.6 experiment is a separate step with its own gate — and it is now
   *possible*, where under the 3.1.1 driver it was not.
8. **`filemd5` is moot.** §4.4.
9. **Step 5's `OP_QUERY` diagnosis is closed by the driver move, not by any code
   change.** `mongodb-8-op-query.md` describes a failure that can no longer
   occur on this tree.
10. **`enableSanitizedErrorResponse: false` is a pinned product decision with a
    named follow-up.** 9.x defaults it on, which answers a CLP refusal to the
    client as the bare string "Permission denied". It was pinned to 2.8.4's
    detailed behaviour because two specs read the message verbatim —
    `access-control` 382 (must name `bnsmetv1_ClanRule`) and `admin-patronage`
    15 (exact "Permission denied for action create on class Patronage."). Turning
    it on is a small, real hardening: the detailed message tells an
    unauthenticated caller which classes exist and what it may not do to them.
    Two lines in `index.js` plus those two assertions, and it wants its own
    commit and its own gate.
11. **`server.js` and `c9-parse-server.js` are still in the tree, and `cors` is
    still in `package.json` because of them.** 13d was skipped by instruction —
    both files were flagged NEEDS OWNER because `dotfiles/initialize_c9.bash:22`
    and `dotfiles/initialize_nitrous.bash:24` reference them, at paths
    (`/home/ubuntu/workspace/`, `/home/nitrous/code/`) that stopped existing
    years ago. `c9-parse-server.js` is a second copy of the exact `ParseServer`
    construction that `5f47dca` fixed, including its own `GET /deez` that Step 7
    already deleted from `index.js` for being unauthenticated and master-keyed —
    and `:23` still calls `.fail(`, which the installed SDK does not have. It is
    now a broken, misleading template of the wrong startup shape sitting next to
    the right one. Deleting both lets `cors` leave. Owner call.
12. **A browser-side change rode in on the server commit.** `5f47dca` touches
    `public/scripts/app/models/Character.js` — the `_.contains` guard around the
    redundant `addUnique`. It is correct under both SDKs (adding an object to an
    array it is already in is a no-op) but it is browser code in a server commit,
    and it accounts for three of that gate's six failures.
13. **`runs/` is gitignored**; only nine records are `git add -f`'d. **`logs/` is
    6.2 GB** on this disk and is also gitignored. `hook-counts.js` reads
    `logs/parse-server.info.<DATE>` — the file is named by *date*, so always pass
    `--run <report.json>` to window it and `--save` to freeze the result before
    the next run appends.
14. **The three permanently skipped tests are now identified** — another §7
    unknown closed. They are `character-sheet.spec.js :: SimpleTrait Edit View
    renders trait sliders and save button`, `creation-werewolf.spec.js :: 212
    Renown allocation … [DEFERRED]`, and `lifecycle-werewolf.spec.js :: 350
    Change 7 - raise Renown … [DEFERRED]`. All three are UI specs, skipped
    identically in the baseline and in the candidate, so they mask nothing the
    migration introduced.
15. **Gate exit codes: only 0 proceeds.** 0 PASS, 1 FAIL, 2 DID NOT RUN,
    3 INCONCLUSIVE. Branch on `exit != 0`, never on `exit == 1` — a wrapper
    testing for 1 alone reads a quarantined-but-uncovered run as a pass. On 3,
    run the targeted re-run the gate itself prints and require 0 from that.
16. **Do not modify `diff-runs.js` or `gate.js`, and do not delete anything in
    `runs/`.** `diff-runs.js`'s eight self-tests are what make it trustworthy;
    `gate.js` carries 42 more plus the quarantine pins.
17. **`C:/prj/yorick/toimport/` holds a production dump and a master key.** Do
    not read it.

---

## 7. If you are picking this up, do these in this order

1. **Push.** Blocker G. Four commits and the whole Step 13 oracle exist on one
   disk.
2. **Settle blockers I and J with the owner**, before anything is scheduled.
   They are the two that fail silently.
3. **Decide M** — `enforcePrivateUsers` — and pin it either way, in its own
   commit, with a gate. It is a two-line change and it is currently the only
   inherited 9.x default left unpinned that changes behaviour.
4. **Fix the build** (blocker D). One glob exclusion plus a copy task, or vendor
   `parse.min.js`. Then actually run `gulp heroku` and look at the output — no
   test in this repo covers `dist/`.
5. **Port the greensboro config** (blockers C and F), with `/1` on the
   serverURL and without `engines`.
6. **Apply the CLP remediation and the `count` repair together**, in one
   maintenance window, with one `heroku restart`.
7. **Then deploy, and work §4's hand-test list — PayPal first, before a real
   payment window.**

13d (§6.11), the sanitized-error-response hardening (§6.10), repointing the
Jasmine suite (§4.7), and moving the staff read behind a Cloud function (§3 M)
are all real and none of them block a deploy.
