<!--
Produced 2026-08-20 after the bump landed at 5f47dca, and revised twice the same
day: once against HEAD 0ce604b, and again after six of the blockers below were
worked. It is now a record of a tree that MOVED WHILE IT WAS BEING WRITTEN, so
the status column, not the prose, is the thing to trust first.

Landed since the original text, and reflected here:
  0ce604b  the lockfile the bump left behind could not be installed by `npm ci`
  f37c6df  blocker J - DB_URI fallback and a deployed-environment refusal
  c16eee2  blocker D - the build, which failed for TWO reasons, not the one
           recorded; `gulp heroku` and `gulp greensboro` now exit 0
  0b93d73  blocker C - the greensboro target, ported with /1 on the serverURL
  fbaf5d7  blocker I - the auditor had no `count` and --fix was a SOURCE of the
           defect; it now reports and repairs it, with a test
  669ae9d  blocker A's last straggler, and two gate self-tests that had been
           silently skipping on a file no branch ever carried
  (this)   blocker M - enforcePrivateUsers pinned, and the refactor it forces
           written up as docs/runbooks/s11-enforce-private-users.md

Blocker G is retired: everything is pushed. Its `origin/topic/parse8-migration
is at b7ddac7` was already false when the first revision was written.

Re-verified by running or reading, for this revision: `git ls-remote origin`;
`npm ci` for real, exit 0; `npm run test:node` for real, 222/221/0/1;
`npx gulp heroku` and `npx gulp greensboro` for real, both exit 0, and the built
output inspected - requirejs paths, the nine parse-compat modules, an md5 of the
copied SDK against its source, and the cache-bust against package.json;
gulp-uglify's own uglify-js over the `minify-js` selection; the installed
parse-server's Options/Definitions.js, RestQuery.js (handleInclude and
replacePointers), MongoSchemaCollection.js, Config.js and MongoTransform.js;
cloud/main.js's crop_and_thumb and its two portrait beforeSave registrations;
database_seed/_SCHEMA.json parsed; the browser `_User` read surface under
public/ and the templates that render a missing user; and node's own test-runner
process isolation, measured rather than assumed.

NOT run, and therefore NOT re-verified: the Playwright gate, hook-counts.js, and
`npm run audit-permissions`. **No suite run and no gate run stands behind any of
the six commits above.** Each is unit-tested where a unit test can reach it, and
several touch code paths - the build, the deploy's database wiring, the count
CLP - that no E2E test in this repo exercises at all. A gate run before deploy
is still owed.

Where this document and docs/runbooks/s10-server-migration-plan.md disagree,
this one is later and was measured; §0 of the plan is superseded by §1 here.
-->
# S10: post-migration handoff

**The server migration is code-complete and green. It is not deployable.**

parse-server 2.8.4 → 9.10.0, node-side `parse` 1.11.1 → 8.6.0, `mongodb`
3.1.1 → 7.1.0, `jimp` 0.2.28 → 0.22.12 all landed, and the full E2E gate
reproduces the pre-migration baseline exactly: 448 expected / 0 unexpected /
3 skipped, against `runs/s10-baseA.json`'s 448 / 0 / 3.

What stands between that and a deploy is five owner decisions and three things
that will break production silently if nobody does them first. **All three are
new. The plan's Phase V list stops at blocker G** — it has a separate blocker H,
and nothing past it. They are §3's blockers I, J and M. Read §3 before scheduling
anything.

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
| 11. Lockfile | **done, and then repaired** | `d6eed08`, `0ce604b` | lock v3. `d6eed08`'s lock could not be installed at all; `0ce604b` regenerated it. `npm ci --dry-run` exit 0 here |
| 12. jimp | **done** | `b7ddac7` | gate 0; `portrait-pipeline-jimp.md` §7 |
| 13a. `.fail` → `.catch` | **done** | `118b6ff` | gate 0, on the legacy stack |
| 13b. `Parse.Promise` → native | **done** | `d67a801` | gate 0, on the legacy stack |
| 13c. `afterSave("SimpleTrait")` | **done** | `fa6d0a4` | gate 0 + hook-counts |
| 13d. delete the dead servers | **NOT DONE — deliberately skipped** | — | flagged NEEDS OWNER; see §6.11 |
| 13e. **the bump** | **done** | `5f47dca` | gate `s10-step13e-3` exit 0 |

Three corrections to the plan's own bookkeeping, for the record:

- **Step 11 needed a second commit, and the reason matters more than the
  bookkeeping.** `d6eed08` left a lockfile that `npm ci` refused outright —
  `npm error Missing: gcp-metadata@8.1.2 from lock file`. `mongodb` 7.1.0
  declares an *optional* peer on `gcp-metadata ^7.0.1` while
  `google-auth-library` pins it at exactly 8.1.2; the install hoisted 8.1.2 to
  the root and marked it `peer: true`, which satisfies `google-auth-library` and
  nothing else. `npm install` tolerates that tree and `npm ci` does not.
  `0ce604b` regenerated the lock — 1 entry added, 6 removed, **zero version
  moves**. Verified here: the lock has no root `node_modules/gcp-metadata` at
  all, 8.1.2 sits under `node_modules/google-auth-library/node_modules/gcp-metadata`
  where its pin comes from, and parse-server 9.10.0 / parse 8.6.0 / mongodb
  7.1.0 / jimp 0.22.12 / bcryptjs 2.4.3 all still hold. **`npm ci` is how a
  deploy target installs**, so the previous lock would have failed the build
  rather than any test — which is precisely what Step 11 existed to prevent.
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
| `diff-runs.js runs/s10-baseA.json runs/verify-bump-independent.json` | **exit 0** — 448 same-pass / 0 NEW-FAIL / 0 new-pass / 0 added / 0 removed / 3 skipped. A **second** post-bump run, recorded half an hour after `s10-step13e-3` and re-diffed here. See §5 |
| `npm run test:node` | **222 tests: 221 pass, 0 fail, 1 skipped.** Was 207/204/3 when this revision began; `669ae9d` repointed the two self-tests that were skipping on a file no branch ever carried, and `fbaf5d7` and `f37c6df` added fifteen cases. The one remaining skip is the by-design one — §6.1 |
| `npm run audit-permissions` | 31 PASSED, 0 WARNINGS, 0 ERRORS — identical to `fbccc99`'s before-picture. Not re-run for this revision |

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

**Five of these were code work and are now done — C, D, I and J landed at
`0b93d73`, `c16eee2`, `fbaf5d7` and `f37c6df`, and A's last straggler at
`669ae9d`. What is left needs the owner, and most of it needs a dyno.**

| # | Blocker | Status |
|---|---|---|
| A | The `/1` path segment | **RESOLVED** |
| B | Node engines pin | **RESOLVED** |
| C | `gulp greensboro` does not exist on this lineage | **RESOLVED in tree** (`0b93d73`) — one premise still unconfirmed |
| D | The build, and the stale committed `dist/` | **BUILD FIXED** (`c16eee2`) — `dist/` itself deliberately untouched |
| E | `YORICK_ALLOW_SEED` must never reach a dyno | **OPEN — standing rule** |
| F | greensboro is a config donor, never a merge source | **OPEN — standing rule** |
| G | The Step 13 oracle lives on one disk | **MOSTLY RESOLVED — everything is pushed; one habit remains** |
| H | `allowClientClassCreation` / production's 29th class | **RETIRED by owner decision** |
| **I** | **Production's `_SCHEMA` has no `count` action** | **OPEN against production** — the repair is now written and tested (`fbaf5d7`) |
| **J** | **`DB_URI` vs `MONGODB_URI`** | **CLOSED in code** (`f37c6df`) — one config var still to confirm on the dyno |
| **K** | **`publicServerURL` still defaults to a dead Cloud9 host** | **OPEN — NEW** |
| **L** | **No mail adapter: password reset sends nothing** | **OPEN — NEW** |
| **M** | **`enforcePrivateUsers` was never dormant — it is 9.x's default and was already live** | **PINNED in code; the refactor it forces is `s11-enforce-private-users.md`, and it is already degrading production** |
| — | The unapplied production CLP remediation | **OPEN, and independent of all of this** |

### A — the `/1` path segment. RESOLVED, with one new trap.

`e5fe9b7` appended `/1` to all six `serverURL` values in
`public/scripts/app/siteconfig.js` (lines 6, 12, 18, 24, 31, 37), and
`index.js` still mounts at `/parse/1`. Verified: every one now reads
`.../parse/1`, and the localhost override at `:64` builds
`window.location.origin + "/parse/1"`.

**The new trap:** `MOUNT_PATH` used to be inert. In the **pre-bump** file
(`5f47dca^:index.js:180`) the mount was `app.use('/parse/1', api);` — a hardcoded
literal that ignored `settings.mountPath`, so setting the env var moved nothing.
`5f47dca` made the mount read the setting: at HEAD it is
`app.use(settings.mountPath, api.app);` (`index.js:254`), fed from
`var mountPath = process.env.MOUNT_PATH || "/parse/1";` (`:115`). **Setting
`MOUNT_PATH` on a dyno now really moves the mount, and every one of those six
client URLs would 404.** Do not set it. If someone ever wants `/parse`, both
halves move together or neither does.

*A note on every `index.js` line number in the original text: they were read off
`5f47dca^`, the pre-bump file, and are therefore a few lines short of the file
that ships. They are corrected below and each is now quoted as well as numbered.*

### B — the Node engines pin. RESOLVED.

`package.json` declares
`"node": ">=20.19.0 <21.0.0 || >=22.13.0 <23.0.0 || >=24.11.0 <25.0.0"` —
parse-server 9.10.0's own range. `.travis.yml` pins `20.19` and `22`, both
inside it. This machine is v24.11.1.

**greensboro still declares `"node": "14.x", "npm": "6.x"`.** That value is part
of the config-donor set in blocker F and it is the one field that must **not**
be ported. Porting it would refuse the install outright.

**And greensboro carries a second node pin that the original text missed.**
`origin/greensboro:.nvmrc` is `14.18.0` — a file this lineage does not have at
all, so it arrives as a clean *addition* in any merge rather than a conflict
(blocker F). A Netlify build reads `.nvmrc`, so porting it would pin node 14
even with `engines` correctly left behind, and the install would refuse for the
same reason. **Both must stay on greensboro: `engines` and `.nvmrc`.**

### C — `gulp greensboro`. RESOLVED in tree at `0b93d73`.

This branch had no greensboro target at all: `gulpfile.js` defined `pubstorm`,
`patron` and `heroku`, and `siteconfig.js` had no `ConfigGreensboro`. A deploy
from here would have errored immediately.

Ported one-directionally, as separate hunks — the `siteconfig-greensboro` task,
the `greensboro` composite, and `ConfigGreensboro`. **Never copy greensboro's
`gulpfile.js` wholesale**: its `clean` task lacks this branch's
`allowEmpty: true`, and its `siteconfig-pubstorm` / `siteconfig-patron` tasks
name config objects that do not exist in its own `siteconfig.js`.

**The serverURL was deliberately not copied verbatim.** greensboro's value is
`https://greensboro-yorick.herokuapp.com/parse` — no `/1`, because that branch
predates blocker A's fix. It is ported as `.../parse/1`. Owner confirmed
2026-08-20 that **greensboro-yorick** is the live app, which also settles the
`after-twilight-yorick` ambiguity this section used to carry.

`gulp greensboro` exits 0 and emits `return ConfigGreensboro;` with the `/1`
URL. It could not have before `c16eee2`: both `minify-css` and `minify-js`
abort the series ahead of every `siteconfig-*` task, so this target would have
been inert on arrival. **C could never have been closed by porting alone.**

**One premise is still unconfirmed and it is the owner's to settle.** Nothing
on either branch declares Netlify's build command — no `netlify.toml`, no
`.netlify`, no `package.json` build script, no workflow file. "`gulp
greensboro` is what Netlify runs" remains an assumption. A screenshot of the
Netlify site's Build & deploy settings, or one deploy log, settles it. The
ported target is harmless if the assumption is wrong.

### D — the build. FIXED at `c16eee2`. `dist/` itself is still stale, on purpose.

**The runbook recorded one cause. Running the build rather than running uglify
by hand turns up an earlier one, and it is why the first went unmeasured for so
long: no build ever ran far enough to reach it.**

`npx gulp heroku` exited 1 at **`minify-css`, the seventh task of twelve**:

```
TypeError: util.isRegExp is not a function
    at merge (node_modules/clean-css/lib/utils/compatibility.js:122:44)
```

`gulp-minify-css@1.2.4` pins clean-css 3.x, which calls `util.isRegExp` —
deprecated as DEP0055 and **removed in node 23**. `package.json`'s `engines`
permits node 24 (blocker B), so the build was broken on a node this repo
declares support for. Swapped for `gulp-clean-css`, the maintained successor,
carrying clean-css 4.2.3 nested under itself. Lockfile change measured: **4
entries added, 0 removed, 0 version moves**; parse-server 9.10.0, parse 8.6.0,
mongodb 7.1.0, jimp 0.22.12 and bcryptjs 2.4.3 all hold, and `npm ci` still
exits 0.

Then, at **`minify-js`**: `gulp-uglify@1.5.4` resolves to `uglify-js@2.6.4` —
its own nested copy, not the 2.3.0 at the root — and 2.6.4 is ES5-only. Of the
**158** files the glob selects (every `.js` under `public/` minus both of its
exclusions), exactly one fails:

```
public/scripts/lib/parse-8.6.0.js
  -> SyntaxError: Unexpected token: operator (>) (line 24, col 27)
```

Line 24 is `var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);`.
That throw rejects the stream and aborts the whole `gulp.series`. The bundle is
now excluded from the glob and shipped verbatim by a `copy-parse-sdk` task,
wired into every composite immediately after `minify-js` — without the copy the
built tree would have no Parse SDK at all and the requirejs `parse-sdk` path
would resolve to nothing.

**Vendoring `parse.min.js` was considered and rejected for now.** It does not
even clear the failure, because the glob still selects `parse-8.6.0.js`; it
would swap the SDK bytes under every E2E spec, since `index.js` serves
`public/` directly and `playwright.config.js` never sets `PUBLIC_BASE`; and it
would strand the source comments citing that file by unminified line number. It
is still worth doing as its own change with a full suite run — `parse.min.js` is
**1.16 MB** against the bundle's **1.77 MB**.

**The built output was looked at, because nothing in this repo tests `dist/`.**
`gulp heroku` and `gulp greensboro` both exit 0 through all twelve tasks. The
built tree maps requirejs `parse` to `parse-compat/parse` and `parse-sdk` to
`parse-8.6.0`, ships all nine `parse-compat/` modules, carries
`parse-8.6.0.js` at an md5 identical to the source, and cache-busts to
`package.json`'s version.

**The committed `dist/` was deliberately NOT rebuilt into any of this.** It is
470 files last touched `14ccc39` (**2021-08-21**), it still maps `parse` to
`parse-1.5.0`, it has no `parse-8.6.0.js` and no `parse-compat/`, and its
`serverURL` has no `/1`. **It cannot run the migrated app; never treat it as a
fallback.** But `pubstorm.json` is `{"name":"yorick","path":"dist"}` — that
directory *is* the published static front end, and the committed copy is a
**patron** build. Rebuilding it in place silently repoints the published app at
whichever target the rebuild used. **Rebuilding and committing `dist/` is a
deploy decision with a target attached, and it belongs in its own commit made
deliberately — not swept up by a `git commit -a` after someone ran gulp.**

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

299 files differ between `origin/greensboro` and HEAD. The merge base is
`1f61ec4`, **January 2020**.

**The stated mechanism was wrong, and the real one is more dangerous because it
is quieter.** greensboro never had the Changeling venue at all —
`git ls-tree -r --name-only origin/greensboro` matches nothing on `changeling`,
while HEAD carries eight such paths — so those files were added on this side
*after* the merge base and a merge does not touch them. Nothing gets deleted.

What `git merge-tree --write-tree HEAD origin/greensboro` actually produces
(HEAD `0ce604b`, greensboro `c2340f0`) is a merged tree that **conflicts on 15
paths and silently differs from HEAD on 32 more**:

- **The 15 conflicts are the loud half and would be noticed.** They are exactly
  the files the migration moved: `index.js`, `package.json`,
  `database_seed/_SCHEMA.json`, `public/scripts/app/siteconfig.js`,
  `gulpfile.js`, both copies of `mobileRouter.js`, `TroupeView.js`,
  `UserSettingsProfileView.js`, `BNSMETV1_VampireCosts.js` and the rest.
- **The other 32 auto-merge with no marker at all** — 2020-era greensboro edits
  landing silently in 2026 files. Among them:
  `public/scripts/app/templates/character-list-item.html`,
  `public/scripts/app/templates/referendum/options.html` (the two templates
  blocker M turns on), `public/scripts/app/views/AdministrationUserView.js`,
  `public/scripts/app/forms/UserForm.js`,
  `database_seed/bnsmetv1_ClanRule.json`, and
  `public/scripts/app/templates/profile-facebook-account.html` — a Facebook
  surface this lineage deliberately removed.
- **Two more resolve by deletion, in the direction nobody wants.**
  `package-lock.json` is *deleted in greensboro and modified in HEAD*: take the
  delete and the lock `0ce604b` just repaired is gone.
  `public/scripts/app/templates/character-print-view.html` is *deleted in HEAD
  and modified in greensboro*, so greensboro's copy is reinstated.
- `.nvmrc` (node 14.18.0 — blocker B) and `ProcfileDashboard` arrive as clean
  additions, no conflict, nothing to notice.

A merge here is not a merge that loses a venue. It is a merge that half-succeeds
and leaves no evidence of the half that did not.

**The rule is unchanged, and this is what it is for: the port is
one-directional**, and is exactly: `gulpfile.js`'s `siteconfig-greensboro` +
`greensboro` tasks, `ConfigGreensboro` in `siteconfig.js` (**with `/1` appended**
— blocker A), `Procfile` (`web: npm start` on both; greensboro's has a trailing
newline and HEAD's does not, which is the only reason the merge reports it as
changed), and the `DB_URI` env-var name (**blocker J**). `engines` **and
`.nvmrc`** are explicitly excluded (blocker B).

### G — the Step 13 oracle lives on one disk. Mostly resolved.

**The push happened, and the original text is now the opposite of true.**
`git ls-remote origin` puts `refs/heads/topic/parse8-migration` at **`0ce604b`,
which is HEAD**. `118b6ff`, `d67a801`, `fa6d0a4`, `5f47dca` and the two commits
after them are all on the remote; `git branch -r --contains 0ce604b` names that
branch. HEAD is **167** commits ahead of `origin/main`. There is nothing to push.

What survives is the artefact-durability half, and it is much smaller than it
was. `runs/` is still gitignored (`.gitignore:117`), but `d7771cd` `git add -f`'d
the records a fresh clone cannot regenerate, so **20 files under `runs/` are now
tracked** — the nine `hooks-s10-*` step records that are the only oracle four
registrations have, `s10-step13e-3.json`, `verify-bump-independent.json`, and the
pre-S10 set. Re-deriving any of the S10 ones means re-running the migration.

**`logs/` is the part that is still disk-only, and that is the right call.**
`hook-counts.js` reads `logs/parse-server.info.<DATE>` — the raw console dumps
the hook counts were derived from, worth nothing once read. **`logs/` does not
exist in a fresh worktree at all** (this one has none), and in the primary
checkout at `C:/prj/yorick` it stood at **3.2 GB** across six files when this was
written. Do not try to preserve it; the `hooks-*.json` records are the part that
mattered and they are safe now.

The remaining exposure is one habit: **a run recorded after `d7771cd` is
untracked until someone `git add -f`s it.** Do that in the same commit as the
work it proves, or it is gone with the worktree.

### I — production's `_SCHEMA` has no `count` action. **NEW. The loud one.**

This is the defect that produced 45 NEW-FAIL on the first gate run, and
production has the identical condition.

**Mechanism, verified in the installed package.** `MongoSchemaCollection.js:91`
opens `const emptyCLPS = Object.freeze({`, and the object it freezes carries
`count: {}`. `mongoSchemaToParseSchema` at `:133` does
`clps = { ...emptyCLPS, ...mongoSchema._metadata.class_permissions }` (`:137-140`).
So a stored class that has a `class_permissions` object but **no `count` key**
comes back with a present-but-empty `count` rule, and
`SchemaController.validatePermission` (`:1333`) reads that as "there is a rule
and nobody matches" rather than "there is no rule".

**The narrower statement is the defensible one, and it is sufficient.** The
regression comes from `count: {}` being present in `emptyCLPS`: a stored CLP
lacking `count` changed meaning from *no rule, allowed* to *a rule nobody
matches, refused*. Whether parse-server 2.8.4 had a separate `count` action at
all is **UNVERIFIABLE from this tree** — 2.8.4 is not installed and is not in the
lockfile — so the earlier claim that "`find` governed it" is not repeated here.
Nothing downstream depends on it; the repair is the same either way.

Fixed in this tree: all **30** classes in `database_seed/_SCHEMA.json` now
declare `count` mirroring `find` exactly. Re-verified by parsing the file (it is
JSONL, one object per line, not a JSON array): 30 entries, 0 missing `count`, 0
where `count !== find`.

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

**`audit_db_permissions.js` now covers this, as of `fbaf5d7`.** Before that
commit the string `count` did not appear in the file at all, and `--fix` was a
*source* of the defect rather than a repair for it: `EXPECTED_RULE_CLP` and
`EXPECTED_APPROVAL_CLP` declared no `count`, and both are applied as a
**whole-object** `$set` of the entire permissions document rather than a merge,
so running `--fix` against production would have written exactly this defect
onto the sensitive rule classes.

What the auditor does now:

- **Grades on what parse-server enforces, not on how the document is written.**
  The merge cannot distinguish an absent `count` key from a stored `{}` or a
  stored `null` — all three arrive as a rule matching nobody — so all three are
  reported as the same outage, at FAIL. A `hasOwnProperty` check would have
  exited 0 on two of the three.
- **Leaves classes with no `class_permissions` alone.** They never reach the
  merge and stay on `defaultCLPS`, which grants `count` to everyone. Writing a
  stored `count` onto one would replace a working default with a rule somebody
  then has to maintain. Their real problem is the fully public create, which the
  public-create sweep already reports.
- **Mirrors each class's OWN `find`**, read from the document in hand — never a
  shared table and never the seed's value, because production's rules have
  drifted from the seed's, and widening `count` past `find` would hand out a row
  count for rows the same caller may not read.
- **Leaves a narrower stored `count` alone**, at WARN. That is somebody's
  decision, not this regression.

`test/audit-count-clp.test.js` pins all of the above without a database.

**Two ordering hazards, both now handled inside a single `--fix` run, and both
worth knowing because the intuitive order is wrong in each case.**

1. The whole-object rule-class replacement must run **before** the count sweep,
   or it discards what the sweep just wrote. Its scope is narrower than this
   runbook once said: not "publicly-writable classes" in general, but the five
   names hardcoded in `SENSITIVE_RULE_COLLECTIONS` — `bnsmetv1_ClanRule`,
   `bnsctdbs_KithRule`, `bnsmetv1_ElderDisciplineRule`, `bnsmetv1_RitualRule`,
   `bnsmetv1_TechniqueRule` — and only those of the five currently allowing a
   public write.
2. The per-class `create` repair uses a **dotted** `$set`. On a class with no
   stored permissions that *creates* an object whose only key is `create` —
   itself the defect. The in-memory document is now kept in step so the sweep
   catches it in the same run.

**What is still open is production, and only the owner can close it.** The
repair is written, tested and runnable; it has never been run against anything
real. Production has 29 `_SCHEMA` entries to the seed's 30 and which class
differs is still unknown, which is exactly why the repair reads each document's
own `find` rather than this repo's.

Run `node audit_db_permissions.js "$PROD_URI" --fix`, then `heroku restart` —
parse-server caches the schema in memory and CLP changes do not take effect on a
running dyno. Verify by logging in as an administrator and reaching the admin
route. There is no other check; nothing in the suite runs against production.

**Note for whoever runs `production-clp-remediation.md`:** its Step 6 says
`node audit_db_permissions.js "$PROD_URI"` should exit 0. Missing `count` now
reports FAIL, and FAIL drives a non-zero exit, so that step returns 1 — once per
affected class — until the repair is applied. That is the check working, not a
regression in it.

### J — `DB_URI` vs `MONGODB_URI`. CLOSED in code at `f37c6df`. One dyno fact left.

greensboro's `index.js:15` reads `process.env.DB_URI`. This lineage's
`getDatabaseURI()` read `process.env.MONGODB_URI` and nothing else, so deploying
this tree onto the live dyno would have found neither variable, probed
127.0.0.1:27017, found nothing, and started an **in-memory MongoDB** — which
reports `{ephemeral: true}`, which `seed_db.js` reads as permission to seed. The
dyno would have come up listening and healthy, serving an empty database freshly
seeded with `devuser` at a password published in this repository, while every
real player's record was simply absent. **Nothing logs an error and the health
check passes.** The only thing standing in the way was an install flag:
`mongodb-memory-server` is a devDependency, so `--omit=dev` makes the require
throw. That is luck, not a guard.

Two changes landed, because either alone leaves the hole open:

- `getDatabaseURI()` now reads **`MONGODB_URI || DB_URI`**, so the deploy does
  not depend on a config-var rename that fails silently the day it is forgotten.
  `MONGODB_URI` wins when both are set, so a dyno can be moved onto the name this
  tree uses by adding it and moved back off by removing it, without either step
  passing through a moment with no database configured.
- A **deployed environment with neither set is refused outright**, before the
  27017 probe, with an error naming both variables. What is being refused is not
  a crash but a success — the fallback does not fail on a deployed host, it comes
  up wrong.

"Deployed" is `NODE_ENV=production` **or** `DYNO`, because neither is
trustworthy alone: `NODE_ENV` is an ordinary config var that can be unset by hand
and nothing else in this repo branches on it, while `DYNO` is set by the platform
rather than by configuration. Neither is set by `playwright.config.js`,
`test_runner.js`, or any npm script, so a local run cannot trip the refusal.

`test/database-uri.test.js` covers precedence, the alias, both refusal signals,
and that an explicit URI still works on a deployed host.

**What is left is one fact only a dyno can supply.** Run
`heroku config -a greensboro-yorick` and confirm which variable is actually set.
The refusal makes the failure loud either way — but it means **the first deploy
of `f37c6df` is the moment a missing config var is discovered**, so confirm it
before shipping rather than after. Confirm `NODE_ENV` too: if the dyno does not
set it, the guard rests on `DYNO` alone.

### K — `publicServerURL` still defaults to a dead Cloud9 host. **NEW.**

`index.js:160` is
`"publicServerURL": process.env.PUBLIC_SERVER_URL || "https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse/1",`.
`c9users.io` has not existed for years.

**The stated mechanism was wrong. The severity is not — if anything it is
sharper, because the damage lands on the write path rather than the read path.**

*Nothing is baked into the database.* `MongoTransform.js`'s `FileCoder`
(`:1371-1387`) stores a `Parse.File` as its bare filename string —
`JSONToDatabase(json) { return json.name; }` — and hands it back as
`{ __type: 'File', name: object }` with no `url` key at all. The URL is
recomputed on every read by `FilesController.expandFilesInObject` (`:72-104`),
which fills in `fileObject['url'] = await this.adapter.getFileLocation(config, filename)`.
`GridFSBucketAdapter.getFileLocation` (`:202-205`) returns
`config.mount + '/files/' + config.applicationId + '/' + encodedFilename`, and
`Config`'s `get mount()` (`:569-575`) returns `publicServerURL` whenever it is
set. So a wrong `publicServerURL` makes every portrait `<img>` on the site point
at a dead host **for exactly as long as the env var is wrong**, and correcting
it repairs every one of them on the next read. No residue there.

*What it actually breaks is portrait uploads, at save time, for everyone.*
`cloud/main.js`'s `crop_and_thumb` does
`var original_url = portrait.get("original").url();` and then
`Image.read(original_url)` — **the server fetches the file it was just handed
back, over HTTP, at whatever host `publicServerURL` names.** Against a dead host
that fetch rejects, and its `.catch` re-throws as
`"could not read the uploaded image back from " + original_url + " - " + reason`.
`crop_and_thumb` is the entire body of the `beforeSave` for both
`CharacterPortrait` and `TroupePortrait`. Under parse-server 9,
`cloud/trigger-compat.js`'s `before_trigger` takes its
`if (!response) { return handler(request); }` arm, so that rejection is handed
straight back to parse-server and **the save is refused**. Not a broken
thumbnail: no portrait row at all, and an error message naming a host nobody
recognises.

*And a refused save does leave residue.*
`public/scripts/app/views/CharacterPortraitView.js` uploads in two steps —
`parseFile.save()` at `:52`, which is a `POST /files` that writes the bytes into
the GridFS `fs` bucket as a standalone file, and only then
`characterPortrait.save()` at `:66`, which is the call `beforeSave` refuses.
`TroupePortraitView.js` has the same shape. So **every refused upload leaves an
orphaned blob in GridFS that no row points at**, and nothing in parse-server or
in this repo ever collects it. That, not the URLs, is what survives the fix.

`PUBLIC_SERVER_URL` must be set on the dyno, to the live origin **plus the
mount path** (`https://<app>/parse/1`). The harness overrides it per worker
(`playwright.config.js:152`), which is why nothing here catches it.

### L — no mail adapter: password reset silently sends nothing. **NEW.**

`index.js:226-236` — the block opening `if (process.env.MAIL_ADAPTER_MODULE) {`,
under the `R51.` comment that starts at `:219`. With `MAIL_ADAPTER_MODULE` unset
it takes the `else` arm, `var MemoryEmailAdapter = require('./cloud/MemoryEmailAdapter');`
(`:230`), and `settings.emailAdapter` becomes an adapter that captures outbound
mail in memory and sends nothing, by design, so the suite never mails anyone.
It says so on startup: `[email] No MAIL_ADAPTER_MODULE set. Outbound email is
captured in memory and never sent.` On a dyno that means the
correctly-wired password-reset button appears to work and no email ever arrives.
Choosing a provider is a deployment decision with credentials attached; it needs
making before anyone relies on reset. (`package.json` no longer declares any
mail adapter — `parse-server-nodemailer-adapter` was dropped at Step 11 as dead,
correctly; nothing referenced it.)

### M — `enforcePrivateUsers`. PINNED at HEAD. It was never dormant.

**The framing in every earlier revision of this section was wrong in a way that
matters: this was not a change riding in on the bump that somebody had to decide
whether to accept. It was already live.**

`enforcePrivateUsers` defaults **`true`** in the installed server
(`Options/Definitions.js:265-270`) and appeared nowhere in this repo outside
`docs/`. 2.8.4 had no such option, so the bump adopted 9.x's answer silently and
the degradation has been running in every environment on 9.10.0 ever since.
Pinning it — which `index.js` now does — **writes the behaviour down without
changing it.** The follow-up work is therefore urgent rather than preparatory,
which is the opposite of what "slow-onset" implied.

What the option actually does, read rather than assumed: a `_User` created
without an explicit ACL gets no public read. **Only on create, and only when the
write supplies no ACL** (`RestWrite.js`, the `_User` branch). Nothing rewrites an
existing row. Two consequences follow, and the second is the one every earlier
revision missed:

- It degrades **gradually**, as people sign up, and turning it off would not
  restore anyone created while it was on.
- **The exposure it is supposed to close is not closed by it.** Production's
  existing accounts keep `_rperm: ['*']` forever, and `database_seed/_SCHEMA.json`
  gives `_User` `find: {"*": true}`. Closing it for real means a CLP change and a
  one-time ACL backfill against production — both irreversible-ish, both the
  owner's call.

**The blast radius is not two call sites.** Earlier revisions named
`models/Troupe.js` and `views/PatronageView.js`. The real browser `_User` surface
is roughly nineteen reads across five kinds — two whole-table sweeps, a
`_Role` relation walk, ten `include()` of a user-valued pointer, and three by-id
gets that reject outright and take their route down with them. They fail
differently and it is worth knowing which is which: a swept row is simply
**absent**, while an included pointer is **deleted from the response entirely**,
which templates render as `DELETED` — including into a downloaded CSV.

**And the single most useful finding is that the includes should be deleted, not
replaced.** `handleInclude` returns immediately when nothing is included, and
`replacePointers` — the code that drops an unreadable include target — is
reachable only through it. So removing an `include("owner")` leaves the raw
pointer intact and unfetched. That one deletion repairs a set of live defects
that have nothing to do with display: characters silently dropped off troupe
rosters, the `playable` filter dropping the same rows, `_check_character_mismatch`
quietly ceasing to fire, and `models/Character.js`'s `get_me_acl` handing a
player's traits to whoever happened to open the sheet. Only the owner's **name**
needs a Cloud function.

**`docs/runbooks/s11-enforce-private-users.md` is that work**, specified to the
commit and verified against the installed server. Eleven commits, of which the
last three need owner sign-off because they change what a user can see or are
irreversible. None of it has landed.

**Neither suite can grade any of it, in either position.** `seed_db.js` writes
`_rperm: ['*', u.id]` straight into Mongo, bypassing the layer this option lives
in, so every seeded account stays publicly readable regardless; no seeded account
has an `email` or a `realname`; and no spec completes a signup. **A green run is
not evidence here.** The spec's §5 names the hand-tests that are.

### The CLP remediation is still unapplied.

`docs/runbooks/production-clp-remediation.md` still reads
**"Status: not yet applied to production."** 23 classes publicly writable,
eleven allowing anonymous create/update/delete, measured against the 2026-07-03
dump. It is independent of everything above and needs no upgrade. It is the only
item on this page that is a live vulnerability rather than a migration task, and
it should be done first or alongside — not after.

Its `--fix` and blocker I's `count` repair touch the same documents. Do them in
one maintenance window, with one restart — **`--fix` first, `count` second**.
The other order is silently self-defeating; blocker I says why.

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

- `index.js:260-277`, opening `app.post('/deez', function (req, res) {` — its
  `.fail(` became `.catch(` at `118b6ff`;
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
deploy. **Do the upload half only after `PUBLIC_SERVER_URL` is set** — blocker K
makes every portrait save fail outright against a wrong one, and each failed
attempt leaves an orphaned blob in the `fs` bucket. Testing this before that is
set costs garbage in GridFS, not just a red result.

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

**And it is no longer one run.** `runs/verify-bump-independent.json` is a second,
separately recorded post-bump run — `startTime` 2026-08-20T21:26:06Z against
`s10-step13e-3`'s 20:56:36Z, a different duration, its own report file — and it
reads 448 expected / 0 unexpected / 3 skipped / 0 flaky, identical to both the
baseline and the first post-bump run. Re-diffed for this revision:
`node diff-runs.js runs/s10-baseA.json runs/verify-bump-independent.json` exits 0
with 448 same-pass, 0 NEW-FAIL, 0 new-pass, 0 added, 0 removed. Both records are
tracked (`d7771cd`), so this is reproducible from a clone.

That matters more than a repeated number. `harness-noise-floor.md` records this
project claiming a zero noise floor off three consecutive clean double-runs and
being corrected twice — first to "roughly one bad run in seven", then, under
sustained load, to worse — before the cause was finally found and fixed in
`6b790dc`. Its standing instruction is to treat a single clean diff as
encouraging, not as proof. One clean run after a whole-stack change is a
measurement; two independent runs agreeing on all 448 outcomes is the evidence
that instruction asks for.

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
- **The seam's contract.** `npm run test:node`, 222 tests, 221 passing, one
  self-skip and that one by design — §6.1. Note what this does and does not
  cover: it is the trigger seam, the gate's own arithmetic, the count-CLP
  decision and the deploy's database wiring. Not one of those touches a
  running server.

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
  the entire Parse File surface. Both passed inline on `s10-step13e-3` and again
  on `verify-bump-independent` (448 expected / 3 skipped on each leaves nothing
  quarantined-but-uncovered), so both runs happen to have full coverage. A future
  run where they fail is exit 3, INCONCLUSIVE, and must be cleared by the
  targeted re-run the gate prints.
- ~~**Two of the gate's own self-tests.**~~ Fixed at `669ae9d`. They needed
  `runs/m20.json`, a file committed on no branch at any point, so both had been
  self-skipping in every clone for the whole migration — reported as skipped,
  never as wrong-file. Both are now repointed at tracked records and both run.
  The general warning stands and is why this bullet is kept: a self-skip is
  silent, so **never read `0 fail` as evidence that every assertion ran.** §6.1.
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

**The second run does not weaken this caveat and should not be read as doing
so.** `verify-bump-independent.json` rules out the harness having been lucky; it
says nothing whatever about intermediate representations, because it makes the
same 448 assertions at the same boundary. Two runs answer "is this reproducible";
neither answers "is the thing underneath it right". The hand-test list in §4
exists for the second question and is not made shorter by the second run.

---

## 6. Things a future session would otherwise rediscover

1. **`npm run test:node` is 222 tests, 221 pass, 0 fail, 1 skipped**, and the
   single remaining skip really is by design: "the replica still matches the
   installed parse-server", which self-skips with *"parse-server is 9.10.0;
   the legacy arm of the seam is dead and so is this check"*.

   It is worth knowing how this number moved, because the reason is a trap
   rather than a tally. The count was 207/204/3 for the whole migration, and
   two of those three skips were **not** by design: `test/gate.test.js` asked
   `needRuns()` for `runs/m20.json`, a file committed on no branch at any
   point. `needRuns()` is silent when a record is genuinely absent, so both
   tests reported "skipped" rather than "you named a file that does not
   exist", and gate.js's advertised 42 self-tests were two short in every
   fresh clone. `669ae9d` repointed them at tracked records; m20 itself
   cannot be regenerated, because it measured a stack that no longer exists.


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
13. **`runs/` is gitignored** (`.gitignore:117`), and `d7771cd` `git add -f`'d
    the records worth keeping — **20 files are tracked now**, not nine. A run
    recorded since then is untracked until somebody force-adds it. **`logs/` is
    gitignored too (`.gitignore:71`) and does not exist in a fresh worktree at
    all**; where it does exist — the primary checkout at `C:/prj/yorick` — it was
    3.2 GB when this was written, nearly all of it two `parse-server.info` dumps.
    `hook-counts.js` reads `logs/parse-server.info.<DATE>` — the file is named by
    *date*, so always pass `--run <report.json>` to window it and `--save` to
    freeze the result before the next run appends.
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

The first four items of the previous list are done — pushed, built, ported and
pinned. What follows is what is actually left.

1. **Confirm the two facts only a dyno and a dashboard can supply**, before
   anything is scheduled. `heroku config -a greensboro-yorick`: which of
   `DB_URI` / `MONGODB_URI` is set, and whether `NODE_ENV` is present (blocker
   J — the refusal makes a missing one loud, which means the first deploy is
   when you find out). And the Netlify site's Build & deploy settings, which is
   the only thing that confirms `gulp greensboro` is what a front-end deploy
   actually runs (blocker C).
2. **Settle the S11 decisions** — `docs/runbooks/s11-enforce-private-users.md`
   §6, D2 through D6. Three of them change what a real user can see, or are
   irreversible. This is now the largest open piece of work, and because
   `enforcePrivateUsers` was never dormant it is **already degrading in
   production**, one signup at a time. Blocker M's old "slow-onset, decide it
   later" framing was wrong.
3. **Set the dyno's config before the first boot, not after.**
   `PUBLIC_SERVER_URL` to the live origin **plus `/parse/1`** (blocker K —
   until it is set no portrait can be saved at all, and every attempt leaves an
   orphaned GridFS blob), `MAIL_ADAPTER_MODULE` if password reset is meant to
   work (blocker L), the database URI under whichever name step 1 settles
   (blocker J), and **not** `MOUNT_PATH` (blocker A), and **not**
   `YORICK_ALLOW_SEED` (blocker E).
4. **One maintenance window, one restart.** `node audit_db_permissions.js
   "$PROD_URI" --fix` now repairs the missing `count` CLP as well as the
   anonymous-write holes, and does the two in the only order that does not undo
   itself. Then `heroku restart` — parse-server caches the schema in memory.
   Then verify by logging in as an administrator and reaching the admin route;
   there is no other check. Blocker I and the CLP remediation, together.
5. **Decide what happens to `dist/`.** The build works now. The committed tree
   is a 2021 patron build that cannot run the migrated app, and
   `pubstorm.json` publishes that directory — so rebuilding it in place
   repoints the published front end at whatever target the rebuild used. That
   is a deploy decision and it wants its own deliberate commit.
6. **Then deploy, and work §4's hand-test list — PayPal first, and before a
   real payment window.**

Still real, still not blocking a deploy: 13d (§6.11), the
sanitized-error-response hardening (§6.10), and repointing the Jasmine suite
(§4.7) — which is now also what `public/scripts/app/testsiteconfig.js` is
waiting on.
