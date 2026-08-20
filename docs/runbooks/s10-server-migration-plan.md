<!--
Produced 2026-08-19 by a five-way parallel audit of the repo (cloud code,
dependencies, oracle coverage, branch/deploy topology, breaking changes),
synthesised and then re-verified against the tree.

Claims are cited to file:line. The ones marked **verified** were run or read on
this machine during the audit; everything about the parse-server 9 / parse 8 /
modern-jimp side is upstream knowledge, because none of those packages are
installed here and there was no network access. That distinction is kept
throughout, because the previous handoff carried two confidently wrong claims
about promise semantics and each cost a full cycle.
-->
# S10: the server-side Parse migration

**Read this first, then start working. Do not summarise it back.**

The browser side is done: `runs/m18.json` is 447 same-pass / 0 NEW-FAIL against
`runs/baseline.json`, reproducing the baseline's exact shape (447 expected, 0
unexpected, 3 skipped). What is left is the server: `cloud/main.js`,
parse-server 2.8.4 → 9.10.0, node-side `parse` 1.11 → 8.6, plus MongoDB, jimp
and the deploy wiring.

Working practice is unchanged — see **`parse8-migration-handoff.md`**, "How to
work in this repo". Keep going until the work is done or you are genuinely
blocked; commit as you go; the commit log is the report. The loop is still:
read the failure out of the captured JSON, reproduce it in a standalone probe,
fix, verify the probe, full suite, diff.

Two numbers in the older runbooks are wrong and are corrected here: it is **55**
live `response.success`/`response.error` calls, not 60, and **35**
`Parse.Promise` uses, not 37. Both were re-counted; see §2.

---

## 1. Two things that are the opposite of what you expect

Read this section before writing any code. Both were verified by execution, not
by reading, and both invalidate the plan you would otherwise write.

### 1.1 Server-side `.fail` RECOVERS the chain

The browser phase established, at some cost, that Parse 1.5's `.fail` does
**not** recover a rejected chain — 1.5 ships `_isPromisesAPlusCompliant: false`
(`public/scripts/lib/parse-1.5.0.js:3892`) and its rejection branch ends at
`promise.reject(result[0])` (`:4126`).

**The node-side SDK is the other way round.** `parse@1.11.1` runs A+ compliant
(`node_modules/parse/lib/node/ParsePromise.js`, and nothing calls
`disableAPlusCompliant`). Verified:

```bash
$ node -e "const Parse=require('parse/node');
  Parse.Promise.error(new Error('boom'))
    .fail(e => 'recovered')
    .then(v => console.log('THEN ->', v), e => console.log('REJECT'))"
THEN -> recovered
```

So in `cloud/` and `index.js`, `.fail(` → `.catch(` is a **faithful,
semantics-preserving rewrite**. Do not import the browser layer's `.fail`
behaviour into server code; it would change behaviour on every one of these
sites.

The corollary is a review rule, not a refactor: several cloud `.fail` handlers
only log (`cloud/main.js:596-604`, `:638-640`, `:1140`), which means they
convert failures into successes today. A mechanical `.catch` preserves that.
Anyone who "improves" them by rethrowing has changed behaviour. Two comments at
`cloud/main.js:930-931` and `:991-993` already record this being observed live.

### 1.2 You cannot pre-convert the 24 Cloud Code handlers

The obvious plan — rewrite the handlers to `(request) => …` first, bump
parse-server second — does not work, because parse-server 2.8.4 ignores what a
modern handler returns:

- **Cloud functions:** `node_modules/parse-server/lib/Routers/FunctionsRouter.js:179`
  is `theFunction(request, response);` and the return value is discarded. A
  handler that returns instead of calling `response.success()` never settles —
  the request hangs.
- **Before-triggers:** `node_modules/parse-server/lib/triggers.js:447` takes
  `trigger(request, response)`, and the returned promise is honoured **only**
  when `triggerType === Types.afterSave || triggerType === Types.afterDelete`
  (`:448-455`). For `beforeSave`/`beforeDelete`, `response.success/error` is the
  only settlement path.

Verified by reading both files in this tree. So the 24 conversions would have to
flip atomically with the bump — precisely the big-bang commit the browser phase
proved is unaffordable.

**Use an adapter**, the same seam that made the browser phase reviewable. See
Step 6. One fact makes it safe: **every hook `success()` in this codebase is
zero-argument** (`cloud/main.js:80, 100, 238, 244, 282, 351, 378, 447, 550, 553,
563, 575, 580, 881`), so parse-server 3.0's "a value returned from beforeSave
replaces the object" semantic cannot bite. `return;` is the modern form
everywhere.

---

## 2. The shape of the work, counted

`cloud/main.js` holds every server-side registration; no other file registers
anything (checked across `cloud/Troupe.js`, `cloud/prettyprint.js`,
`cloud/MemoryEmailAdapter.js`).

| | count | lines |
|---|---|---|
| `Parse.Cloud.define` | 13 | 17, 643, 673, 692, 719, 755, 770, 809, 888, 1033, 1058, 1067, 1114 |
| `beforeSave` | 9 | 150, 155, 160, 199, 310, 540, 573, 578, 830 |
| `afterSave` | 3 | 397, 583, 607 |
| `beforeDelete` | 2 | 415, 557 |

There are **zero** `afterDelete`, `beforeFind`, `afterFind`, `beforeLogin`,
`beforeSaveFile`, `beforeConnect`, `beforeSubscribe` and zero `Parse.Cloud.job`.

The 3 `afterSave` hooks are already `function(request)`. The other **24** use
the removed `(request, response)` signature.

Settlement and promises: **55** live `response.success`/`response.error` calls
(a raw grep says 60; 5 are in prose comments at 356, 515, 925, 1080, 1081 and 3
sit inside the block comment at 902-919). **35** live `Parse.Promise` uses (26
in `main.js`, 9 in `cloud/Troupe.js`). **Zero** `.always(` and `.done(`
server-side, so none of the browser phase's ordering traps apply. `useMasterKey`
appears 38 times; `sessionToken` never.

Two helpers own the leverage: `require_a_user` (`:142-148`) is called from 10
hook entry points, and `crop_and_thumb` (`:62-103`) from the 3 portrait hooks.
Converting those two touches 11 of the 27 registrations.

---

## 3. The gate does not work for server changes

`diff-runs.js` was written for a phase where only browser assets changed. Three
holes only bite when the *server* is the variable, and the first is severe.

**Hole A — the gate passes when nothing ran.** Verified in-process: comparing
`m18` against an empty report gives `newFail: 0, removed: 451, samePass: 0`, and
`diff-runs.js:222` exits `newFail.length > 0 ? 1 : 0`. So a run that produced
zero tests prints **"No regressions."** and exits 0.

This is not hypothetical. `seed_db.js:4` imports `ObjectID` and `seed_db.js:91`,
`:167` plus `audit_db_permissions.js:100` call
`MongoClient.connect(uri, { useNewUrlParser: true })`. The installed driver is
`mongodb@3.1.1`, supplied transitively by parse-server — bumping parse-server
silently bumps it. mongodb 7 removed the `ObjectID` alias and **throws** on
unknown client options. `index.js:106` seeds on every boot and
`e2e/global-setup.js` aborts the run if the seeded users are missing. So the
first thing S10 does trips the one hole the gate cannot see.

**Hole B — `reuseExistingServer: !CI`** (`playwright.config.js:129`). If a
previous run's backends are still listening, Playwright never starts the new
ones and you measure the *old* server. `index.js` prints no version banner, so
nothing catches it.

**Hole C — serial-file skip masking.** 17 of the 21 spec files call
`test.describe.configure({ mode: 'serial' })`, and `diff-runs.js` drops any pair
where either side is `skipped` from the classification. Measured on real
artifacts: `m18` vs `m19` reports **1 NEW-FAIL while `samePass` falls 447 → 433**.
A NEW-FAIL count of 1 can mean fifteen broken tests.

---

## 4. The plan

### Phase I — repair the gate, before touching any dependency

**Step 1. Build the gate wrapper. ~3-4h, 0 new suite runs.**

One script (`npm run gate`) that: sweeps ports 1337-1344 (`e2e/ports.js`) and
refuses to start if anything answers, or forces `CI=1`; runs the suite with
`E2E_RUN_NAME`; **asserts the candidate produced tests** (`removed === 0`, or
`expected + unexpected` within a small delta of the baseline); then runs
`diff-runs.js` and additionally fails if `samePass` dropped or `skipped` rose
above the baseline's 3.

Wrap `diff-runs.js`, do not modify it — its 8 self-tests
(`test/diff-runs.test.js`) are what make it trustworthy.

*Oracle for this step:* its own behaviour. `m18` vs an empty report must exit
non-zero. `m18` vs `m19` must report the 1 NEW-FAIL **and** the 14-test
`samePass` drop.

**Step 2. Record the S10 baseline and quarantine the two flakes. ~1h, 0-4 runs.**

`runs/baseline.json` is not a valid S10 baseline: it was recorded on the legacy
browser stack, before 17 commits of app-code change. Record fresh runs of
unmodified HEAD through the Step 1 gate, so the baseline is produced by the same
path candidates will be.

Quarantine `admin-referendums` test 49 and `assets-rename-portrait` test 114 by
name, and say so in the gate script. Both are pre-existing harness noise — test
49 fails with a **byte-identical** signature on the legacy stack
(`runs/candidate.json`, `runs/vendor.json`, `runs/w4a.json` all carry
`Expected: 2, Received: undefined` at `admin-referendums.spec.js:452:45`). See
`harness-noise-floor.md`.

**`runs/` is gitignored.** Copy the chosen baseline somewhere durable or
`git add -f` it. If this worktree is deleted, S10 has no oracle.

*Owner decision:* root-cause 49 and 114 first, or quarantine through S10?
Quarantining is defensible but means a real regression in those two files, and
in their serial tails, would be invisible.

**Step 3. Add the log-marker oracle. ~2-3h, rides along on runs you do anyway.**

`index.js:120` sets `verbose: true`, and cloud code already emits unique hook
entry markers (`cloud/main.js:317, 398, 420, 586, 610`). Add matching markers to
`beforeSave("Vampire")`, the three portrait hooks, `LongText` and
`VampireCreation`, then write a script that counts each marker in
`logs/parse-server.info.*` and diffs the counts between two runs.

This is the only oracle that covers `afterSave("Patronage")` and
`afterSave("SimpleTrait")`, and it answers *"did this hook run at all"* — the
dominant failure shape of the browser phase, where ten of eighteen regressions
were something silently no longer happening.

*Honest limit:* it proves the hook entered, not that it completed correctly, and
it cannot cover `PaymentPaypal`, which no run triggers.

**Step 4. Decide the `PaymentPaypal` question. Owner decision.**

`afterSave("PaymentPaypal")` (`cloud/main.js:607`) and the `/deez` routes
(`index.js:157-186`) have no test, no caller in the app, and depend on a global
`Parse` that parse-server 9 may not inject. Delete, write a contract test, or
accept as unverified and hand-test after deploy. **This is a decision about live
payment ingestion, not an engineering one — ask.**

### Phase II — de-risk single variables against the unchanged stack

**Step 5. MongoDB 8.2.6 alone. ~30min, 2 runs. The only free experiment in S10.**

`index.js:83` reads `process.env.MONGODB_BINARY_VERSION || '4.4.18'`, and both
binaries are already cached (`mongod-x64-win32-4.4.18.exe` and
`mongod-x64-win32-8.2.6.exe`). So:

```bash
MONGODB_BINARY_VERSION=8.2.6 npm run gate
```

isolates "MongoDB 8 broke it" from "parse-server 9 broke it" with **zero code
change**. If it is clean you have removed a variable; if it is dirty you have a
storage-engine diagnosis with the whole rest of the stack held fixed.

Watch the portrait specs specifically: `mongodb@3.1.1`'s GridStore issues a
`filemd5` command on every file write, and whether that command still exists on
modern MongoDB is one of the genuine unknowns (§6).

### Phase III — shrink the surface, under the oracle that currently works

Everything here lands on parse-server 2.8.4, where the differential works. Each
item makes the eventual bump diff smaller. Order within the phase is flexible.

**Step 6. The Cloud Code adapter, and all 24 conversions. 1.5-2 days, 6-8 runs.**

Add a seam in `cloud/` — sketch, not final:

```js
var LEGACY = true;  // one line to flip when parse-server is bumped

function defineFn(name, fn) {
  if (!LEGACY) return Parse.Cloud.define(name, fn);
  Parse.Cloud.define(name, function (request, response) {
    Promise.resolve().then(function () { return fn(request); })
      .then(function (v) { response.success(v); },
            function (e) { response.error(e); });
  });
}
```

…and the `beforeSave`/`beforeDelete` equivalent, whose success path is
`response.success()` with no argument (safe — see §1.2).

Then rewrite each handler into modern form: `response.success()` → `return;`,
`response.success(x)` → `return x;`, `response.error(x)` → `throw x;`.
`require_a_user` becomes a `throw` and its 10 call sites lose their
`if (!require_a_user(...)) { return; }` guard. `crop_and_thumb` becomes
promise-returning and its 3 callers `return crop_and_thumb(request)`.

Why this shape:

- Under 2.8.4 the adapter reproduces today's behaviour exactly, so **the full
  suite covers the conversion** — including the audit-row hooks, which assert
  the exact `VampireChange` shape rather than just that a save succeeded.
- At bump time, flipping `LEGACY` is one line and the 24 handlers do not move
  again. The bump commit stays reviewable.
- Hook rejection *messages* must survive verbatim at `cloud/main.js:853` and
  `:867` — asserted with `toContain` at `e2e/approvals.spec.js:1007, 1019, 1058,
  1106`. The suite asserts Parse error *codes* only for CLP/ACL cases (119,
  101), never for hook rejections, so parse-server 3.0's change in how hook
  rejections are coded cannot break it.

Land in slices, gating after each: helpers first (11 registrations), then the
audit-row hooks (best oracle), then the covered Cloud functions, then the rest.

*Check by hand, not by diff:* `record_experience_notation`
(`cloud/main.js:550-554`, `:563-565`) deliberately answers the request and
*then* dispatches an async write. Whether that fire-and-forget still completes
under a promise-returning parse-server 9 is unverified. Watch
`e2e/xp-history.spec.js` after the bump.

**Step 7. Delete what does not need porting. 2-3h, 2 runs.**

- Three dead Cloud functions, zero callers repo-wide: `hello` (`:17`),
  `removeRedundantHistory` (`:643`), `update_indv_vc_permissions_for` (`:692`).
  Two of them do privileged writes with **no master key** (`:646-652`,
  `:700-702`), so they are already broken under the hardened CLPs — deleting is
  strictly safer than converting.
- `beforeSave("ReferendumPortrait")` (`:160`) — that class's `_SCHEMA` entry has
  `"create":{}`, so nothing can create it.
- The dead block at `cloud/main.js:1186-1205`, after an unconditional `return;`,
  referencing three identifiers that do not exist in the file.
- `var request = require("request")` (`cloud/main.js:8`) — **zero call sites**.
  Free deletion. (The package stays in the tree transitively via `jimp@0.2.28`
  and parse-server until both move; do not expect the audit to go quiet.)
- `server.js`, `my-parse-server.js`, `c9-parse-server.js` — nothing references
  them, and two duplicate the exact `ParseServer` bootstrap you are about to
  change. Delete, or port it four times.
- `index.js`'s `oauth` block — not a parse-server option at any version (the
  option is `auth`). Delete, do not rename; Facebook login is already
  deliberately removed.

**Step 8. Master-key the four unauthenticated `_User`/`_Role` reads. 1-2h, 2 runs.**

`cloud/main.js:1102` (`matchUserInRoles`, reached from `change_troupe_staff`),
`cloud/Troupe.js:24`, `:41`, `:56`. All read `_User`/`_Role` with no options,
relying on the fully-public seeded `_User` CLP.

**This is the highest-risk silent change in S10 and the suite cannot see it.**
Seeded users get `_rperm: ['*', id]` (`seed_db.js:60-61`), so the suite stays
green while newly-signed-up real players — who under modern parse-server's
`enforcePrivateUsers` get a private ACL — vanish from troupe staff lists.
`{useMasterKey: true}` is correct under *both* versions, so land it now, under
the old oracle, where it is a provable no-op.

**Step 9. Set the security-relevant options explicitly. 1h, 2 runs.**

- `allowClientClassCreation` — 2.8.4 defaults it `true`; modern versions default
  it `false`. All 30 non-system classes the app persists already exist in
  `database_seed/_SCHEMA.json`, so a freshly seeded database is unaffected. The
  exposure is production, whose `_SCHEMA` the seeder has never touched.
- `enforcePrivateUsers` — set it, and decide which way, in the same commit as
  Step 8.
- `fileUpload` — decide now, apply with the bump (see Step 13).
- `verbose` — currently unconditional (`index.js:120`) and it produced a **3.9 GB**
  log in one local day. Env-gate it. On a dyno, every character sheet body goes
  to the platform log drain.

Also run `npm run audit-permissions` (`audit_db_permissions.js`, read-only
without `--fix`) against a worker database **before and after** the bump. It has
never been used differentially, and it is the only thing that would catch
parse-server reinterpreting the `_SCHEMA`.

**Step 10. Decouple the seeder from parse-server's transitive driver. 3-4h, 2 runs.**

Declare `mongodb` explicitly in `package.json` — it is currently a **phantom
dependency**, resolved only because parse-server pins it. Fix `seed_db.js:4`
(`ObjectID` → `ObjectId`), `seed_db.js:91`, `:167` and
`audit_db_permissions.js:100` (drop `useNewUrlParser`). Replace
`seed_db.js:5`'s `require('parse-server/lib/password')` with a direct
`bcryptjs` dependency — `seed_db.js:56` uses exactly one function.

**This must precede the bump, in its own commit.** It is the concrete instance
of Hole A.

**Step 11. Regenerate the lockfile, on its own. 1h, 1 run.**

`npm ci` is broken today: `package-lock.json` still lists
`karma-phantomjs-launcher` and `phantomjs-prebuilt` in root devDependencies,
neither of which `package.json` declares or `node_modules` contains. The lock is
v2 while `node_modules/.package-lock.json` is v3.

Drop the four dead dependencies (`request`, `cors`, `require`,
`parse-server-nodemailer-adapter` — "nodemailer" appears nowhere in the repo;
the live path is `cloud/MemoryEmailAdapter.js`), then regenerate. Separately, so
the bump diff is not entangled with a lockfile-format rewrite.

### Phase IV — the bump

**Step 12. jimp, on its own. 4-6h, 2-3 runs.**

Six call sites in the thumbnail helpers (`cloud/main.js:28, 32, 40, 50, 84, 87`)
plus five in the harness (`e2e/helpers/images.js`). The dangerous one is
`cloud/main.js:84`, `Image.read(portrait.get("original").url())` — the URL-fetch
form, which `jimp@0.2.28` implements using the `request` package.

Prefer `jimp@0.22.x` (last 0.x): it keeps the callback signatures and
`MIME_JPEG`. `jimp@1.x` is a rewrite into 26 scoped packages with no callbacks.

The complication: jimp is shared between the code under migration and the
harness that verifies it. Either pin the harness to old jimp while the server
moves, or move both and accept that the portrait diff has no independent oracle
for that step.

*Oracle:* `assets-rename-portrait.spec.js`, 30 specs, real end-to-end uploads —
the best-covered step in S10, which is why it deserves its own commit and run.
Remember test 114 lives in this file and is quarantined; its serial tail is 14
tests.

**Step 13. parse-server 2.8.4 → 9.10.0 and node-side parse 1.11 → 8.6. 2-3 days, 6-10 runs.**

Same commit, necessarily: nothing server-side does `require('parse')` —
`cloud/main.js:1` and `cloud/Troupe.js:1` are `/* global Parse */`, and
`index.js` uses a bare `Parse`. The global comes from parse-server's
`addParseCloud()`. **Also bump `package.json`'s `parse` from `^1.9.0` to
`^8.6.0`**, or the hoist slot keeps 1.x and the migration reports success while
the node side runs the 2018 SDK.

Edits in this commit:

1. `index.js:149-150` — `new ParseServer(cfg)` no longer returns an Express app.
   2.8.4 exports a *factory* returning `server.app`
   (`node_modules/parse-server/lib/index.js:52-56`); modern versions export the
   class. Becomes roughly
   `const server = new ParseServer(cfg); await server.start(); app.use('/parse/1', server.app);`.
   `startServer()` is already `async`. **This makes cloud-code loading
   asynchronous**, which changes when hook registration completes relative to
   `listen()` — and therefore when the Playwright `webServer` URL answers. A
   boot regression appears as a wall of `webServer` timeouts across 8 workers,
   not as a test failure. **Run `node index.js` by hand first.**
2. Flip `LEGACY` in the Step 6 adapter.
3. `Parse.Promise` → native; `.fail(` → `.catch(` (faithful, per §1.1).
4. `cloud/main.js:755-768` — the `{success, error}` options object on
   `Parse.User.logIn`, dropped at SDK 2.0. Under parse 8 the third argument is
   an options bag, so neither callback fires and `check_user_password` **hangs
   rather than erroring**. No E2E oracle. Delete it with `make_me_admin`, or
   hand-verify.
5. `fileUpload.{enableForPublic,enableForAuthenticatedUser,enableForAnonymousUser}`
   — all default `false` since parse-server 4.4. If unset, every portrait upload
   fails and the 30 `assets-rename-portrait` specs go red at once, which reads
   as a jimp regression and is not one.

*Oracle:* the full gate, plus the Step 3 log-marker diff, plus
`npm run test:node` (`test/parse-compat-events.test.js` asserts its own premise
and reports the SDK version it exercised — run it immediately after the
dependency bump), plus `npm run audit-permissions` before/after.

*Check these first, before anything else in this step:* does parse-server 9
still set `global.Parse`? Does it still ship `lib/password` (moot if Step 10 is
done)? Does it reject unknown top-level config keys (deleting `oauth` in Step 7
removes the only known offender)? Does it validate handler arity at
registration — loud — or call the handler with one argument — quiet, 24 runtime
failures?

### Phase V — before any deploy

**None of this is S10 code work, and none of it should be started without the
owner.**

**Blocker A — the `/1` path segment.** All six `serverURL` values in
`public/scripts/app/siteconfig.js:6, 12, 18, 24, 31, 37` end in `/parse`,
because Parse 1.5 appended `1/` itself. parse@8 does not, and `index.js:150`
mounts at `/parse/1`. Only `ConfigLocalhost` is rewritten, which is why the E2E
suite is unaffected and **why no test in this repo can catch it.** Two mutually
exclusive fixes: append `/1` to the deployed strings, or set `MOUNT_PATH=/parse`
and change `app.use` to match. Doing both, or the dyno half alone, 404s every
API call. This is the likeliest way to break production with a correct-looking
build.

**Blocker B — the Node engines pin.** `package.json` has no `engines` block;
`.travis.yml` pins Node 8; greensboro pins `14.x`/npm `6.x`. parse-server 9.10.0
requires `>=20.19 <21 || >=22.13 <23 || >=24.11 <25`. Note this is an owed debt,
not a new prerequisite: the tree **already** cannot run on Node 14, because
`mongodb-memory-server@11.2.0` — a current devDependency required at boot —
declares `engines: node >=20.19`.

**Blocker C — `gulp greensboro` does not exist on this lineage.** `gulpfile.js`
defines `pubstorm`, `patron`, `heroku` only, and there is no `ConfigGreensboro`.
If that is Netlify's build command, a deploy from this branch errors
immediately. Porting is two small files.

**Blocker D — `dist/` is stale and cannot run the migrated app.** It is missing
all the `parse-compat` files, `parse-8.6.0.js`, `VenueClass.js`, and its
`app.js` still maps `parse` to the 1.5 bundle. The deploy rebuilds it, so it
does not need committing — but never treat the committed `dist/` as a fallback.
Open risk: `gulp-uglify@1.5.3` is ES5-only and has never been run against
`parse-8.6.0.js` or `parse-compat/`.

**Blocker E — `YORICK_ALLOW_SEED` must never be set on a dyno.** The seeder gate
(`seed_db.js`, commit `152f031`) exists **only on this lineage** — not on
`main`, not on `greensboro`. The E2E harness sets that variable
(`playwright.config.js`), and copy-pasting env blocks is exactly how it would
leak. This also fixes the landing direction: production wiring must be ported
*onto* this branch and deployed from here.

**Blocker F — greensboro is a config donor, never a merge source.** 117 files
differ; merging it would delete the entire Changeling venue that roughly 26 of
the tests cover. The port is one-directional: `gulpfile.js`, `siteconfig.js`,
`Procfile`, the `DB_URI` vs `MONGODB_URI` env-var name, and `engines`.

**Blocker G — push the work.** 62 commits are on no remote. S10 touches
`package.json` and `node_modules`; a botched install that forces a reclone
destroys them, and the `runs/` evidence with them.

**Not S10, but adjacent:** `C:/prj/yorick/toimport/` holds a 436 MB production
dump and `greensboro_master_key.txt` (plus a vim undo file containing the same
key). Gitignored, so this is local-disk exposure, not repo. Nothing in S10 needs
either file — tell agents the path exists so they never read it, and rotate the
key once the CLP work lands.

**CLP remediation — parallel lane, start now.** `production-clp-remediation.md`
states it is independent of the modernization and needs no upgrade. It is the
only item here that is a live vulnerability rather than a migration task.

---

## 5. Sizes and run budget

A full 8-worker suite is **4-5 minutes** (measured: `stats.duration` 252-303s
across m17-m20), so a two-run gate is a ~12-minute loop.

| Step | Effort | Suite runs |
|---|---|---|
| 1. Gate wrapper | 3-4 h | 0 |
| 2. Baseline + quarantine | 1 h | 0-4 |
| 3. Log-marker oracle | 2-3 h | rides along |
| 4. PaymentPaypal decision | owner | 0 |
| 5. MongoDB 8.2.6 alone | 30 min | 2 |
| 6. Adapter + 24 conversions | 1.5-2 d | 6-8 |
| 7. Deletions | 2-3 h | 2 |
| 8. Master-key the role reads | 1-2 h | 2 |
| 9. Explicit security options | 1 h | 2 |
| 10. Seeder/driver decoupling | 3-4 h | 2 |
| 11. Lockfile regeneration | 1 h | 1 |
| 12. jimp | 4-6 h | 2-3 |
| 13. parse-server 9 + parse 8 | 2-3 d | 6-10 |

**Roughly 6-8 working days and 25-36 suite runs** (~2-3 hours of pure suite
time). Step 13's range is wide because it is the only step where an
unknown-unknown from an uninstallable package can cost a day.

---

## 6. What has no oracle at all

Four hooks can be broken and every suite in the repo stays green:

- `afterSave("SimpleTrait")` (`cloud/main.js:397`) writes `simple_trait_id`,
  which **nothing reads** — structurally unobservable.
- `afterSave("Patronage")` (`:583`) copies `expiresOn` onto owned Vampires; the
  hook fires during `admin-patronage.spec.js` but no spec asserts the effect.
- `afterSave("PaymentPaypal")` (`:607`) — nothing triggers it.
- `beforeSave("LongText")` (`:573`) and `beforeSave("VampireCreation")` (`:578`)
  are guard-only.

Six of the 13 Cloud functions are never called in a full day of suite runs.
`make_me_admin` and `check_user_password` are privilege-relevant and covered
only by the Jasmine suite, which is itself broken (below).

`require_a_user` guards 10 entry points, but the only anonymous-write probe in
the suite is against `Vampire`, and even that is masked by the class-level
permission — so if the guards stop running, the CLP still refuses and nothing
fails. The R1-R51 security work is effectively invisible to the differential.
Consider adding direct REST probes (no session token) as part of Step 1.

**The Jasmine suite is not usable as-is.** It drives a live backend but still
loads the legacy Parse 1.5 SDK (`public/scripts/app/tests/test-main.js` maps
`parse` to `parse-1.5.0` while the app maps it to `parse-compat/parse`), so it
would test parse-server 9 through a 2015 client. Repointing it is a one-line
change. Do **not** quote "166 executed / 140 pass / 26 fail" as fact — a static
count of the spec files yields 173 registrations and the gap is unexplained. At
least a large family of the failures looks like a missing fixture rather than a
security guard: `testsiteconfig.js` sets `SAMPLE_TROUPE_ID: "WOad4CBTsG"`, which
exists in no seed file (`database_seed/Troupe.json` is 2 bytes). Fixing that
would be a cheap way to give the six uncovered Cloud functions an oracle — but
it is speculative until someone runs it.

---

## 7. What could not be verified

> **Correction, 2026-08-20: there is network access.** `npm view` and
> `npm install` both reach the registry from this machine. The paragraph below
> was written when they did not, and it is the single assumption that made this
> section's list unanswerable.
>
> Demonstrated rather than asserted: `jimp@0.22.12` was installed into a scratch
> directory *outside the repo* and its failure behaviour measured directly
> against a local HTTP server, which settled one of the Step 12 unknowns in
> about a minute (see `portrait-pipeline-jimp.md` §1 for the table, and §5 for
> what it means for that step).
>
> **Every item in the list below can now be answered the same way** — install the
> target package into a scratch directory and probe it. That is a far cheaper
> question than it was when this plan was written, and it is worth doing
> *before* Step 13 rather than discovering the answers inside it. Step 13's
> effort range is wide specifically because "an unknown-unknown from an
> uninstallable package" could cost a day; the package is no longer
> uninstallable.
>
> Do this in a scratch directory. Installing the S10 target stack into the repo
> would replace the working `node_modules` that the browser phase's evidence and
> the gate both depend on, and Blocker G's warning about a botched install still
> stands.


**Nothing from the S10 target stack is installed on this machine, and there was
no network access.** parse-server 9.10.0, the parse 8.6 node build, modern jimp,
mongodb driver 5/6/7 — none of them. Every statement about how those versions
behave is upstream knowledge. Only the 2.8.4 / 1.11.1 / 0.2.28 / 3.1.1 side was
read from disk.

Specifically unverified, and load-bearing:

- Whether parse-server 9 still injects `global.Parse`, still ships
  `lib/password`, rejects unknown config keys, or validates handler arity at
  registration.
- Whether modern jimp's `read` still accepts an HTTP URL, and whether
  `rgbaToInt` survives at the package entry point.
- Whether the `filemd5` command GridStore issues still exists on MongoDB 5.0+.
  If it does not, portrait uploads have been broken in production since that
  move and the upgrade would *fix* them — which changes how you read any
  "portraits are broken" report.
- Production's actual `_SCHEMA`: 29 entries in the 2026-07-03 dump versus 30 in
  the seed. Which class is missing is unknown.
- **Which Heroku app is live.** greensboro's source default and its committed
  `dist/` both point at `after-twilight-yorick.herokuapp.com`, while the gulp
  task named for the branch emits `greensboro-yorick.herokuapp.com` and the CLP
  runbook restarts `greensboro-yorick`. Unresolvable from the repo. **Owner
  question.**
- Whether `gulp-uglify@1.5.3` can minify `parse-8.6.0.js` and `parse-compat/`.
  Never exercised.
- Which three tests are permanently skipped, and whether they touch any cloud
  function.

**Production MongoDB is 5.0.32 Community, self-hosted on a DigitalOcean
droplet** — owner-stated 2026-08-17,
`docs/designs/yorick-modernization-differential-cutover.md:92`, explicitly
superseding the earlier Atlas inference. The practical consequence for Step 5's
production counterpart: **there is no managed snapshot button.**

---

## 8. Start here

**Build the gate wrapper (Step 1) — specifically the assertion that the
candidate run produced tests.**

Not because it is hard, and not because it is the biggest risk, but because it
is the one thing that makes every other step's answer *mean* something, and
because the failure it catches is both the most likely S10 outcome and the most
expensive to misdiagnose.

The hole is demonstrated, not theorised: an empty candidate report yields
`newFail: 0` and `diff-runs.js` exits 0, printing "No regressions." The browser
phase never had to care, because static assets always load. S10 changes the
server, and the server is the thing that can fail to exist. The evidence that
this is not hypothetical is already in the tree — `seed_db.js` calls a driver
API that the bump removes, `index.js` seeds on every boot, and `global-setup.js`
aborts the run when seeding fails.

A gate that cannot distinguish "everything passed" from "nothing ran" is not a
gate. Three hours buys back every hour the rest of the plan spends.
