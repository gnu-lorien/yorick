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

## 0. Status, 2026-08-20 — read this before section 1

Phase I and most of Phase III are done. **Several load-bearing claims below are
now wrong**, and they are corrected here rather than edited in place, so the
original reasoning stays legible next to what measurement did to it.

### Done

| Step | State | Evidence |
|---|---|---|
| 1. Gate wrapper | **done** | `gate.js`, `test/gate.test.js`, 27 self-tests |
| 2. S10 baseline | **done** | `runs/s10-baseA.json` — 451 discovered, 448 passed, 3 skipped, committed |
| 3. Log oracle | **done** (`9389ad1`) | `hook-counts.js`, 19 self-tests |
| 4. PaymentPaypal | **decided — see below** | owner, 2026-08-20 |
| 5. MongoDB 8.2.6 alone | **answered — the experiment is impossible** | gate **2**; `mongodb-8-op-query.md` |
| 6. Before-trigger seam + conversions | **done** (`9d374af`..`10279f2`) | seven gates, all 0 |
| 7. Deletions | **done** (`5347818`) | gate 0 |
| 8. Master-key role reads | **done** (`dcdff91`) | gate 0 |
| 9. Explicit options | **done** (`fbccc99`) | gate 0 |
| 10. Seeder/driver decoupling | **done** (`c666b31`) | gate 0 |

Not done: **11** (lockfile), **12** (jimp), **13** (the bump).

**Step 5 is closed, and §5's premise below is wrong.** MongoDB is not a
separable variable: under `MONGODB_BINARY_VERSION=8.2.6` the backend never
boots. `mongodb@3.1.1` frames every operation as a legacy `OP_QUERY`
(`mongodb-core/lib/wireprotocol/3_2_support.js:145`, `:611`, `:667`; there is no
`OP_MSG` path in that package at all), and 8.2.6 refuses it — code 352,
`UnsupportedOpQueryCommand`, on the seeder's first `find`. **The layer is the
driver, not the storage engine and not parse-server**, proven by a probe holding
only `mongodb@3.1.1` and a mongod. The control run at 4.4.18, same commit, same
minute, gates 0. So the mongo move is welded to the driver move and therefore to
Step 13; re-run it there, and check the new driver's *minimum* server version
while you are at it, because the pairing may invert. It also leaves §7's
`filemd5` unknown untouched — the run reached no test at all. Full record and
the production caveat (production is 5.0.32; this only tested the harness's
in-memory mongod): **`mongodb-8-op-query.md`**.

Unrelated but relevant: the harness flake that made all of this hard to measure
was root-caused and fixed (`6b790dc`); see `harness-noise-floor.md`. Full runs
are now clean, which is why the four gates above mean something.

### The big correction: §1.2 and Step 6 are wrong about what breaks

Measured against a real parse-server 9.10.0 install. **It is not "24 handlers
that fail silently". It is 13 that do not fail at all and 11 that fail loudly,
some of them fatally.**

- **All 13 `Parse.Cloud.define` handlers work unchanged.** parse-server 9
  *restored* Express-style support: `Routers/FunctionsRouter.js:333` is
  `if (theFunction.length >= 2) return theFunction(request, responseObject);`.
  Verified live: `response.success(v)` resolves, `response.error(m)` rejects
  with code 141 and the verbatim message.
- **The 10 before-triggers break** — 8 `beforeSave` + 2 `beforeDelete`; this said
  11, and the arithmetic in the paragraph below it ("9 beforeSaves → 8", plus the
  two beforeDeletes) always said 10. `triggers.js:838` is a bare
  `trigger(request)`; there is no arity branch anywhere in that file.
  - settling **synchronously** → save rejected, code 141,
    `"Cannot read properties of undefined (reading 'success')"`.
  - settling **asynchronously** (inside a `.then`) → unhandled TypeError →
    parse-server's own `uncaughtException` handler (`ParseServer.js:352`) →
    **`process.exit(1)`. The backend dies.**

  The async kind includes both portrait hooks — there are **two** registrations,
  `TroupePortrait` and `CharacterPortrait`, sharing one `crop_and_thumb`, which
  settles in a `.then`; `create_thumbnail` is the third function and is not a
  registration — and by inspection `beforeSave("Vampire")`,
  `beforeSave("SimpleTrait")`, `beforeDelete("SimpleTrait")` and
  `beforeSave("VampireApproval")`. Six of the ten.

  **Operationally:** flip the bump before the Step 6 adapter and the first
  portrait or character save kills that worker's backend. Across 8 Playwright
  workers that reads as a cascade of connection failures *mid-suite* — not a
  boot failure, and not a test failure either. Know this shape before you see it.

- **No arity validation at registration.** Nothing warns. Registration is silent
  either way.

So Step 6 shrinks: the adapter only has to cover **before-triggers**, and after
Step 7's deletions the conversion count is **20, not 24** (13 defines → 10,
9 beforeSaves → 8). The defines can convert later, or never, on their own
schedule — they are no longer coupled to the bump.

### Step 6 is done, and it is smaller than the plan below describes

Seven slices, `9d374af`..`10279f2`, each with its own full gate. All ten
before-triggers now register through **`cloud/trigger-compat.js`** as
`compat.beforeSave(...)` / `compat.beforeDelete(...)`; no `Parse.Cloud.before*`
call remains in `cloud/`. The 10 `Parse.Cloud.define` handlers and the 3
`afterSave` handlers are deliberately **unchanged** — neither is coupled to the
bump, and touching them would have spent gate cycles for no change in behaviour.

**There is no `LEGACY` flag, and Step 13 has nothing to flip.** The seam detects
at invocation: 2.8.4 calls a before-trigger as `trigger(request, response)`
(`triggers.js:447`) and honours the returned promise only for afterSave and
afterDelete (`:448`); parse-server 9 calls `trigger(request)`. So
`response === undefined` **is** the version test, read from the server actually
running. A flag would have had to be flipped by hand, and the cost of forgetting
is not a red test — six of these hooks settle inside a `.then`, which is the
`process.exit(1)` cascade described above, created by missing one line.

Two hazards found in the conversion, both of which would have been silent:

1. **Every async rejection handler needed an explicit `throw`.** A `.fail`/
   rejection handler that returns normally *recovers* the chain — node-side
   `parse@1.11.1` is A+ compliant (`ParsePromise.js:39`, branch at `:171-198`) —
   so deleting `response.error(error)` and leaving the handler otherwise empty
   makes the hook's promise **resolve**, allowing a write it had just decided to
   refuse. Five sites; all five carry the `throw` now, and a comment saying why.
2. **`beforeSave("SimpleTrait")`'s mid-chain success.** Success used to be
   signalled at the `isMeaningfulChange` short-circuit with two `.then()`s still
   to run. Now the chain's completion *is* the success signal, so the
   `_.isUndefined` sentinels must stay and the chain must keep running.

`record_experience_notation`'s answer-then-dispatch survives, and its own commit
(`84462f6`) records why: the property that mattered was never "success is called
on the line above", it was that the hook does not await the audit write. Both
hooks return `undefined` and the write is never inside the returned promise.
`dispatch_experience_notation_record` wraps it so a *synchronous* throw out of
the dispatch cannot refuse an operation already allowed — a guarantee the old
shape got for free, and one that Steps 12 and 13 could easily take away.

Measured after the last slice, windowed to `runs/s10-step6-7.json`: all twelve
logged trigger tallies **identical to `runs/hooks-s10-baseA.json`, `failed`
columns included** — `Vampire/beforeSave` 987/1, `VampireApproval/beforeSave`
12/4, `CharacterPortrait/beforeSave` 2/1. The hooks that reject still reject, in
the same places, the same number of times. Saved at
`runs/hooks-s10-step6-7.json`; **use that, not `hooks-s10-baseA.json`, as Step
13's before-picture** — the baseline was recorded before four server-config
commits and its `get_expected_vampire_ids` tally (89, against 58-60 now) is stale
for reasons that have nothing to do with cloud code.

### §7's unknowns, now answered

| Question | Answer |
|---|---|
| `global.Parse` still injected? | **Yes** — `ParseServer.js:58` calls `addParseCloud()` at module load, `:547` assigns it. `/* global Parse */` needs no change. `Parse.Promise` is gone, as assumed. |
| `lib/password` still shipped? | **Yes**, `{hash, compare, dummyHash}`, backed by bcryptjs. And bcryptjs 3.0.3 verifies hashes made by the repo's 2.4.3 — **no existing password is invalidated**. |
| Rejects unknown config keys? | **No.** `validateKeyNames()` ends at `logger.error(...)`; there is no throw path. `oauth` was never a boot blocker, only a permanent error line. |
| Handler arity validated? | **No.** See above. |
| Startup shape | `const s = new ParseServer(cfg); await s.start(); app.use(mount, s.app)` — and `start()` **must** be awaited before `listen()`: cloud code is `require`d inside it (`ParseServer.js:181-198`), so hooks are not registered until it resolves. `app.use(path, api)` on the class throws `TypeError: argument handler must be a function` — loud, at wiring time. |
| Promise returned from beforeSave honoured? | **Yes**, and a rejection carries the message **verbatim** — which is what `approvals.spec.js`'s `toContain` assertions rely on. |
| Value returned from beforeSave? | **Ignored**, unless it is a thenable resolving to `{object: …}` (`triggers.js:844-853`). That shape does not occur here, so `return;` and `return somePromiseChain` are both safe. |
| Engines | parse-server 9.10.0 needs node 20.19+/22.13+/24.11+ (below 21/23/25 respectively). This machine is **v24.11.1** — satisfies it. |

**§9's `fileUpload` claim is wrong.** The plan says all three default `false`.
In 9.10.0, `enableForAuthenticatedUser` defaults **`true`**; only
`enableForPublic` and `enableForAnonymousUser` are `false`. There is also a new
default `fileExtensions` whitelist that blocks html/svg/xml (a `.html` upload
gets 400 code 130), and `allowedFileUrlDomains: ["*"]`. So portrait uploads by a
logged-in player are **not** the 30-spec cliff the plan predicts — but the
extension whitelist is a new behaviour that did not exist before.

**§9's `allowClientClassCreation` reasoning was half the story**, and the missing
half is a deploy risk: it gates **reads** as well as writes
(`RestQuery.js:234`, reached on every query), throwing 119 rather than returning
`[]` for a class absent from `_SCHEMA`. Production's `_SCHEMA` has 29 entries to
this seed's 30 and the missing one is unknown. It is therefore shipped as
`process.env.ALLOW_CLIENT_CLASS_CREATION === "1"` — modern value by default,
proven by the gate, with production able to keep the old behaviour for one
release. **See Blocker H.**

### Step 3's premise is wrong, and the real oracle is better

The plan says to add cloud-code markers and count them in
`logs/parse-server.info.*` with `verbose` on. **Cloud `console.log` never reaches
that file at any level** — parse-server does not redirect `console`, so those go
to stdout. Measured against a 31 MB verbose log: zero hits for every cloud marker.

What *is* there, at `level:"info"`, is parse-server's own trigger log
(`triggers.js:273`, `:283`), structured with `className` and `triggerType`:

```
504 Vampire/beforeSave   220 SimpleTrait/beforeSave   220 SimpleTrait/afterSave
132 SimpleTrait/beforeDelete   86 VampireCreation/beforeSave
 54 ExperienceNotation/beforeSave   36 ExperienceNotation/beforeDelete
 11 LongText/beforeSave    7 Patronage/afterSave
```

That covers `afterSave("SimpleTrait")` and `afterSave("Patronage")` — the two
hooks §6 calls structurally unobservable — and it is `logger.info`, so it
**survives `verbose:false`**. Failures are `logger.error` (`triggers.js:292`).

So Step 3 is cheaper than budgeted, needs no code change to `cloud/`, and Step 9's
verbose gating does not damage it. **Do not add cloud markers. Do not set
VERBOSE=1.** Count parse-server's own lines.

**Step 3 is now built: `hook-counts.js`, `npm run hook-counts`.** Four things it
measured that this section did not know:

1. **It covers the `define` handlers too, free.** `FunctionsRouter.js:153` logs
   `Ran cloud function <name>` at `level:"info"` with a `functionName` field, and
   `:164` is the failure. So the same oracle watches 19 of the 23 registrations in
   `cloud/`, not just the triggers. The four it can never see are
   `afterSave("PaymentPaypal")`, `check_user_password`, `make_me_admin` and
   `submit_facebook_profile_data` — nothing exercises them, so they read as zero
   in every run and always will.
2. **All eight workers append to ONE log file, and there is no way to tell them
   apart.** `logsFolder` resolves against `process.cwd()`
   (`parse-server/lib/defaults.js:11`), and `playwright.config.js` starts every
   backend as `node index.js` from the repo root — `logs/parse-server.info.2026-08-18`
   carries requests for all of ports 1337-1344. The trigger lines carry no port,
   host or pid. **The diff is per-run and aggregate; per-worker is not available
   even in principle.** That is enough, because a before-trigger that dies under
   parse-server 9 dies on all eight at once.
3. **The file is named by DATE, so a naive count is the whole day.**
   `logs/parse-server.info.2026-08-20` holds 96,913 hook records across the day's
   ~22 runs; the `runs/s10-baseA.json` run alone is 4,362 of them. Always pass
   `--run <report.json>` — it takes the window from the report's
   `stats.startTime`/`duration` — and `--save` to freeze the result before the
   next run appends.
4. **A before-trigger record means SETTLED, not entered.** `triggers.js:431`
   writes it from inside the `response.success` callback, so the parse-server 9
   failure (no `response`, never settles) makes the count fall to zero. That is a
   strong signal. An `afterSave` record is written at `:449` right after the
   trigger returns, before its promise settles and with rejections swallowed, so
   for the two afterSave hooks it only means *entered*. Weak, and still the only
   oracle they have.

The before-picture for Step 13 is saved at **`runs/hooks-s10-baseA.json`**,
windowed to the `runs/s10-baseA.json` gate baseline — gitignored like every other
run record, so re-derive it with
`node hook-counts.js logs/parse-server.info.2026-08-20 --run runs/s10-baseA.json --save runs/hooks-s10-baseA.json`
if it is gone. Compare with
`node hook-counts.js --diff runs/hooks-s10-baseA.json <new counts>`. Its figures:

| hook | ok | failed | | hook | ok | failed |
|---|---:|---:|---|---|---:|---:|
| `Vampire/beforeSave` | 987 | 1 | | `CharacterPortrait/beforeSave` | 2 | 1 |
| `SimpleTrait/beforeSave` | 865 | 0 | | `TroupePortrait/beforeSave` | 2 | 0 |
| `SimpleTrait/afterSave` | 865 | 0 | | `VampireApproval/beforeSave` | 12 | 4 |
| `SimpleTrait/beforeDelete` | 516 | 0 | | `Patronage/afterSave` | 7 | 0 |
| `VampireCreation/beforeSave` | 500 | 0 | | `get_expected_vampire_ids` | 89 | 0 |
| `ExperienceNotation/beforeSave` | 282 | 0 | | `get_my_patronage_status` | 23 | 0 |
| `ExperienceNotation/beforeDelete` | 158 | 0 | | `update_vampire_change_permissions_for` | 10 | 0 |
| `LongText/beforeSave` | 20 | 0 | | `change_troupe_staff` | 9 | 0 |
| | | | | `vote_for_referendum` | 4 | 2 |
| | | | | `get_captured_emails` | 2 | 0 |
| | | | | `request_password_reset_for` | 1 | 0 |

The `failed` column is not damage. Every one of those eight is a negative-path
spec getting the rejection it asked for — checked in `logs/parse-server.err.2026-08-20`:
`VampireApproval` "Players cannot approve their own character changes",
`Vampire/beforeSave` "Characters can only be changed by a logged in user" on an
anonymous create probe, `CharacterPortrait` on a `.txt` uploaded as a portrait,
`vote_for_referendum` "Existing ballot found". They have to stay non-zero too — a
hook that stops rejecting is as much a regression as one that stops running,
which is why `hook-counts.js` tracks `ok` and `failed` separately instead of
summing them.

### Step 4, answered by the owner

**PayPal patron ingestion is LIVE.** Money still flows `POST /deez` →
`PaymentPaypal` → `afterSave` → `Patronage`. It is ported, not deleted.

- `afterSave("PaymentPaypal")` is already `function(request)` so it needs no
  signature change, but its `.fail(...)` does (faithful per §1.1).
- Note what it does today: a failed `Patronage` save is swallowed into a
  `console.log`. **A payment that fails to become a subscription is silent.**
  Preserve that in the migration — changing it is a product decision — but it is
  worth raising separately.
- `POST /deez` depends on a bare global `Parse` (fine — it still exists) and on
  the `ipn` verifier. **This is the one path in S10 that can lose money
  silently, and no test can cover it.** It belongs on the post-deploy hand-test
  list, exercised *before* a real payment window, not after.
- **`GET /deez` is deleted** — leftover debug, unauthenticated, `useMasterKey`,
  returned a character name to anyone. No caller.

### Two corrections to Step 8, and one to Step 13

**Step 8 does not close the exposure that motivates it.** `cloud/Troupe.js`'s
`get_staff` has zero server-side callers. The staff roster a player actually sees
is rendered by `TroupeView.js:146` from `public/scripts/app/models/Troupe.js` — a
**browser-side copy** of the same module, issuing the same unauthenticated
`_User` query from the client, where a master key is neither available nor
appropriate. The commit is still correct and still lands, but closing the real
exposure means moving that read behind a Cloud function. **Design change, owner
call, not a migration edit.**

Related, and a loaded gun: `get_staff` now walks a role's `users` relation with
the master key and returns whole `_User` objects. The moment anyone exposes it to
a client it ships every troupe member's email address, bypassing both
`enforcePrivateUsers` and 9.10.0's default `protectedFields`. Whoever writes that
caller must strip fields at the boundary.

**Step 13 must re-pin `mongodb`.** Step 10 declared it at `3.1.1` exact to stop
it moving underneath the seeder. At the bump, parse-server 9 pins mongodb 7.x and
npm will hoist the *root's* 3.1.1, nesting 7.x under `parse-server/` — so
`seed_db.js` and `audit_db_permissions.js` would keep loading the 2018 driver and
the `ObjectId` / `useNewUrlParser` edits would never be exercised on the driver
they were written for. Step 13's edit list does not mention this. Add it.

### Blocker H — `allowClientClassCreation` and production's 29th class

New, belongs with the Phase V blockers. Before any deploy, establish **which
class is in this seed's `_SCHEMA` and not production's**. Until then production
must run with `ALLOW_CLIENT_CLASS_CREATION=1`, or a read path nobody touched
starts throwing 119. The dump at `C:/prj/yorick/toimport/` would answer it — but
it also contains a master key, so that is an owner task, not an agent one.

---
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
zero-argument**, so parse-server 3.0's "a value returned from beforeSave replaces
the object" semantic cannot bite. `return;` is the modern form everywhere. (The
line list that stood here — `:80, 100, 238, …` — was stale by Step 7's deletions
and is now history: there are no hook `success()` calls left at all. The claim
itself held, and `cloud/trigger-compat.js` relies on it: the seam always calls
`response.success()` with no argument and discards whatever a handler returns, so
a stray `return x` is harmless on both versions.)

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

> **DONE, and this section is superseded — see §0.** Cloud `console.log` never
> reaches that file at any level, so the markers below would have counted zero.
> `hook-counts.js` counts parse-server's *own* trigger log instead, needs no
> change to `cloud/`, and covers the defines for free. **Do not add cloud
> markers. Do not set VERBOSE=1.** ("the three portrait hooks" below is also
> wrong; there are two.)

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

> **Run 2026-08-20. It is free and it is impossible — do not run it again.** The
> backend does not boot: `mongodb@3.1.1` speaks only the legacy `OP_QUERY`
> opcode and 8.2.6 refuses it (352). Gate 2, DID NOT RUN. See §0 and
> `mongodb-8-op-query.md`. Everything below is left as written.

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

> **DONE, and this section is superseded — read §0's "Step 6 is done" first.**
> It was 10 before-triggers, not 24 handlers; there is no `LEGACY` flag; the
> defines never moved. The sketch below is kept because the reasoning around it
> is still worth reading, not because it describes what shipped.

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
`require_a_user` becomes a `throw` and its call sites lose their
`if (!require_a_user(...)) { return; }` guard — **9 sites, not 10; Step 7's
deletions took one**. `crop_and_thumb` becomes promise-returning and its callers
`return crop_and_thumb(request)` — **2 callers, not 3**.

Why this shape:

- Under 2.8.4 the adapter reproduces today's behaviour exactly, so **the full
  suite covers the conversion** — including the audit-row hooks, which assert
  the exact `VampireChange` shape rather than just that a save succeeded.
- At bump time, flipping `LEGACY` is one line and the 24 handlers do not move
  again. The bump commit stays reviewable. — **Superseded.** There is no flag;
  the shipped seam detects `response === undefined` at call time, so the bump
  commit does not touch `cloud/` at all. See §0.
- Hook rejection *messages* must survive verbatim — asserted with `toContain` at
  `e2e/approvals.spec.js:1007, 1019, 1058, 1106`. The plan put them at
  `cloud/main.js:853`/`:867`; they are now **`:874`** and **`:888`**, and they
  move whenever anything above them does, so find them by text. The suite asserts
  Parse error *codes* only for CLP/ACL cases (119, 101), never for hook
  rejections, so parse-server 3.0's change in how hook rejections are coded
  cannot break it.

Land in slices, gating after each: helpers first (11 registrations), then the
audit-row hooks (best oracle), then the covered Cloud functions, then the rest.
— **What shipped:** seven slices, and the ordering that worked was seam-first on
the two hooks that are *only* a guard (nothing in the conversion can be blamed
for a failure, only the seam), then the exact-shape audit-row oracles, then the
verbatim-message hook, then the portraits. The "covered Cloud functions" clause
is moot: the defines never moved.

*Check by hand, not by diff:* `record_experience_notation`
(`cloud/main.js:550-554`, `:563-565`) deliberately answers the request and
*then* dispatches an async write. Whether that fire-and-forget still completes
under a promise-returning parse-server 9 is unverified. Watch
`e2e/xp-history.spec.js` after the bump. — **Half-answered.** The hook no longer
awaits it and cannot: both ExperienceNotation hooks return `undefined`, so the
write is never inside the promise parse-server waits on. What remains genuinely
unverified at the bump is whether parse-server 9 lets the process live long
enough for a detached write to land after the response is sent. Still watch
`xp-history.spec.js` 54-75.

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
2. ~~Flip `LEGACY` in the Step 6 adapter.~~ **Delete this step — there is no
   flag.** `cloud/trigger-compat.js` reads `response === undefined` at call time
   and needs no edit at bump. Do not go looking for a constant; there isn't one,
   and adding one would reintroduce exactly the half-bumped window it avoids.
3. `Parse.Promise` → native; `.fail(` → `.catch(` (faithful, per §1.1).
   **Read `cloud/trigger-compat.js` before doing this.** Its async branch calls
   `.then` on whatever the handler returns, which is a `Parse.Promise` today and
   a native one after; both are fine. What is not fine is dropping any of the
   five `throw error` lines in the rejection handlers — see §0's hazard 1. They
   look like they do nothing and they are the difference between refusing a write
   and allowing it.
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
  "portraits are broken" report. **Still open after Step 5**, which was supposed
  to answer it: the 8.2.6 run never reached a file write, or any test, because
  the driver was refused at the first query. It moves to Step 13, against a
  different driver. See `mongodb-8-op-query.md`.
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
