# Dependency Vulnerabilities

**`npm audit` went from 64 vulnerabilities (1 critical, 32 high, 26 moderate, 5 low)
to zero.** The Parse 8 / parse-server 9 migration was not disturbed:
`parse@8.6.0`, `parse-server@9.10.0` and `mongodb@7.1.0` are untouched.

Two surfaces were fixed, and only one of them is visible to `npm audit`:

- the **npm tree** — the server, and the build toolchain
- the **vendored browser libraries** under `public/scripts/lib/`, which `npm audit`
  is structurally blind to because they are files in the repo, not packages

---

## Status

| | before | after |
|---|---|---|
| critical | 1 | **0** |
| high | 32 | **0** |
| moderate | 26 | **0** |
| low | 5 | **0** |
| **total** | **64** | **0** |

`npm audit` reporting zero is not the same as the app being clean — see
[What is left](#what-is-left). The browser-side libraries it cannot see are the
reason that section exists.

Verified, after every change was in place:

| gate | result |
|---|---|
| `node --test test/*.test.js` | 249 pass, 1 skip, 0 fail |
| `npm test` (Karma, browser units) | **166 SUCCESS**, 1 skip |
| `npx playwright test` (full E2E) | **449 pass**, 2 skip, **0 fail** |
| `node e2e/check-syntax.js` | 40 E2E files OK |
| `npx gulp greensboro / heroku / patron / pubstorm` | all four build end to end |

The Karma run matters most for the vendored-library swaps: it is the suite that
loads `require.js`, `moment` and the parse-compat shims in a real browser.

---

## What changed

### Production server (npm)

`express` and its chain were bumped inside their existing caret ranges — no major,
no `--force`:

| package | before | after | cleared |
|---|---|---|---|
| express | 4.17.1 | 4.22.2 | GHSA-rv95-896h-c2vc, GHSA-qw6h-vgh9-j6wx |
| body-parser | 1.19.0 | 1.20.6 | GHSA-qwcr-r2fm-qrc7 (high) |
| serve-static | 1.14.1 | 1.16.3 | GHSA-cm22-4g7w-348p |
| qs | 6.7.0 | 6.15.3 | GHSA-hrpp-h998-j3pp (high) |
| path-to-regexp | 0.1.7 | 0.1.13 | three high ReDoS advisories |
| send | 0.17.1 | 0.19.2 | GHSA-m6fv-jmcg-4jfg |
| cookie | 0.4.0 | 0.7.2 | GHSA-pxg6-pf52-xh8x |

### Transitives under parse / parse-server (npm `overrides`)

Twelve advisories under `parse-server` collapse to **three** root packages. npm's
own suggested fix for all of them is a downgrade — see [Traps](#traps) — so they are
pinned forward with `overrides` instead:

```json
"overrides": {
  "ws": "8.21.3",
  "ip-address": "10.5.0",
  "follow-redirects": "1.16.0",
  "uuid": "11.1.1"
}
```

- **`ws` 8.20.0 → 8.21.3** clears GHSA-96hv-2xvq-fx4p (high, memory-exhaustion DoS)
  and GHSA-58qx-3vcg-4xpx. This is not a stopgap: `parse@8.6.0` and
  `parse-server@9.10.0` are both the latest published releases and both pin `ws` at
  exactly `8.20.0`, so there is no upstream release to wait for. Covers all three
  copies in the tree, including the nested one under `@parse/push-adapter`.
- **`ip-address` → 10.5.0** clears GHSA-mwp4-54f8-5fhr (high — `Address4` decodes
  leading-zero octets as decimal while resolvers decode them as octal, giving SSRF
  and trust-boundary bypass). Reached through `express-rate-limit`, which pins
  `10.1.0` exactly.
- **`follow-redirects` → 1.16.0** clears GHSA-r4q5-vmmm-2653 (auth headers leaked to
  cross-domain redirect targets). `parse-server` pins `1.15.11` exactly.
- **`uuid` → 11.1.1** clears GHSA-w5hq-g745-h8pq. This one forces a major on
  `gaxios`, `google-gax` and `teeny-request`, which declare `^9.0.1`. That is
  acceptable because **the chain is dead code**: no push adapter, Firebase or
  Google Cloud adapter is configured anywhere in `index.js`, `server.js`,
  `c9-parse-server.js` or `cloud/main.js`. Verified that `parse-server` and
  `@parse/push-adapter` still load, and that `uuid` v4/v5 still work.

### `jimp` 0.22.12 → 1.6.1 (portrait pipeline)

The last four advisories were all one root cause: **GHSA-5v7r-6r5c-r473**, an
infinite loop in `file-type`'s ASF parser on malformed input, reaching
`@jimp/core` → `@jimp/custom` → `jimp`. It is reachable — `cloud/main.js` calls
`Image.read` on user-uploaded portraits — so it was worth doing properly.

**An override cannot fix it.** The fix is `file-type` ≥ 21.3.1, which is ESM-only
(`"type": "module"`), while `@jimp/core@0.22.12` is CJS and declares
`file-type@^16.5.4`. Pinning it forward breaks jimp at require time. jimp 1.6.1
carries `file-type@21.3.4` and audits clean on its own.

**Correcting a claim that was made in the first pass of this work:** jimp 1.x does
**not** remove remote-URL reading. `Jimp.read(url)` over HTTP was measured working on
1.6.1, and its failure messages are byte-identical to 0.22.x's — `"HTTP Status 404
for url ..."` for a non-200 and `"Could not find MIME for Buffer <null>"` for a body
whose type cannot be sniffed. That is what `crop_and_thumb`'s `.catch` and its
`!image` guard were written against, so neither had to change. Had the removal been
real, this migration would have needed its own fetch layer; it did not.

What actually changed, all mechanical:

| 0.22.x | 1.6.1 |
|---|---|
| `require("jimp")` **is** the class | `{ Jimp, JimpMime, rgbaToInt }` namespace |
| `Image.MIME_JPEG` | `JimpMime.jpeg` (same `"image/jpeg"` string) |
| `getBuffer(mime, cb)` | `getBuffer(mime)`, returns a promise |
| `scaleToFit(w, h, cb)` | `scaleToFit({ w, h })`, mutates and returns `this` |
| `crop(x, y, w, h)` | `crop({ x, y, w, h })` — positional form is *rejected*, not deprecated |
| `new Jimp(w, h, color, cb)` | `new Jimp({ width, height, color })` |
| `Jimp.rgbaToInt` | top-level `rgbaToInt` |
| `image.write(path, cb)` | `await image.write(path)` |

Because `getBuffer` and `write` now return promises and `scaleToFit` returns `this`,
the four hand-rolled callback-to-promise wrappers in `create_thumbnail` and
`makeFixturePng` were deleted rather than translated — the chains kept their shape
and lost their scaffolding.

Two things were checked rather than assumed. The buffer round trip in
`create_thumbnail` (`getBuffer` → `Image.read`) looks redundant and is not: all four
thumbnail sizes are built concurrently from one `input_image`, `scaleToFit` mutates
in place, and decoding a fresh instance per size is what stops them resizing each
other's pixels. And the committed fixtures — written by jimp 0.2.28 — still decode to
exactly the colours the assertions expect; a fixture regenerated on 1.6.1 is 12 bytes
smaller with pixel-identical content, matching what `makeFixturePng`'s existing
comment already documents about the 0.2.28 → 0.22.x bump.

Verified with `npm run test:e2e:assets` — **30 passed**, covering the center crop, all
four thumbnail sizes, and the "uploaded file is not an image" rejection path.

### Vendored browser libraries

`npm audit` cannot see any of these. Each replacement was **byte-diffed against the
pristine upstream tarball of its currently-vendored version first**, to prove it
carried no local patches before overwriting it.

| file | before | after | cleared |
|---|---|---|---|
| `lib/hello.js` + `hello.min.js` | hellojs 1.16.1 | **1.21.4** | GHSA-7jh9-6cpf-h4m7 (**critical**, XSS), GHSA-g3vf-47fv-8f3c (**critical**, prototype pollution) |
| `lib/require.js` | RequireJS 2.1.18 | **2.3.8** | GHSA-x3m3-4wpv-5vgc (high, prototype pollution) |
| `lib/moment.js` | moment 2.10.6 | **2.30.1** | GHSA-8hfj-j24r-96c4 (high, path traversal), GHSA-446m-mv8f-q348 (high, ReDoS) |
| `lib/papaparse-4.1.2.js` | papaparse 4.1.2 | **`papaparse-5.6.0.js`** | GHSA-qvjc-g5vr-mfgr (high, ReDoS) |

`hello.js` deserves a note, because the obvious reading is wrong. The `<script>` tag
for it in `index.html` is commented out, which makes it look dead. It is not:
`public/scripts/app/loadall.js:8` requires `"hello"` on every boot, and the library
runs `hello.utils.responseHandler(...)` at **module top level**, which parses
`location.search` and `location.hash` before any user action. Two criticals sat on
the first-paint path of every authenticated session.

`require.js` is the same shape of trap in reverse: bumping the `requirejs`
**devDependency** (2.3.6 → 2.3.8, needed for the Karma peer) does nothing for the
browser, because `public/index.html` injects `scripts/lib/require.js` directly.
Both had to move.

### Deletions — dead code carrying advisories

Removing an unused vulnerable dependency is strictly better than upgrading it.
Each of these was verified unreferenced before removal:

- **`public/external/`** and **`public/js/requirejs.config.js`** — jQuery 1.10.2,
  jQuery 1.11.1, RequireJS 2.1.2, QUnit 1.14.0. Only `public/js/requirejs.config.js`
  referenced them, and nothing referenced *it*. This was not merely dormant: the
  `minify-js` task globs `./public/**/*.js`, so the whole directory was being
  **shipped to production**. `dist/external/` is removed to match.
- **`public/scripts/lib/js.cookie.js`** — js-cookie 2.0.3, GHSA-qjx8-664m-686j
  (high). `mobileRouter.js` listed `"jscookie"` in its `define` array and bound it
  as `Cookie`, and that identifier appears nowhere else in the file. Never called,
  so deletion beats a 3.x major. The AMD dependency array and factory parameter list
  are positional, so both the `"jscookie"` entry and the `Cookie` parameter were
  removed together — dropping one without the other silently shifts every later
  binding.
- **`nodefy`** (devDependency) — high, `range=*`, `fixAvailable: false`, so it
  survived both `npm audit fix` and `--force`. Referenced only by its own line in
  `package.json`.
- **`url-search-params`** (devDependency) — no advisory; surface reduction. The app
  deliberately uses the vendored `url-search-params.max.amd.js`.

### Build toolchain

Twenty-one of the remaining advisories were the gulp chain. `gulp-htmlmin` and
`gulp-uglify` were replaced rather than upgraded, because **every** published
version of `gulp-htmlmin` depends on `html-minifier`, which is vulnerable at
`range=*` — there is no version to move to.

| before | after | note |
|---|---|---|
| `gulp` 4.0.2 | **5.0.1** | clears the chokidar/braces/micromatch/anymatch/readdirp/glob-watcher chain |
| `gulp-clean` 0.3.2 | **0.4.0** | drops `gulp-util` / `lodash.template` |
| `gulp-debug` 2.1.2 | **4.0.0** | 4.x is the newest CJS line; 5.x is pure ESM and this gulpfile is CJS |
| `gulp-uglify` 1.5.4 | **`gulp-terser` 2.1.0** | |
| `gulp-htmlmin` 2.0.0 | **`gulp-html-minifier-terser` 8.0.0** | the only way to clear `html-minifier` and `clean-css` |

`gulp-clean-css` stays at 4.3.0 — its `clean-css@4.2.3` is not vulnerable. The low
`clean-css` finding came from `html-minifier@2.1.7` and left with it.

`outSourceMap: true` was dropped along with gulp-uglify. It was producing nothing:
`dist/` contains zero `.map` files.

`gulpfile.js` also now excludes `public/scripts/lib/parse-1.5.0.js` from `minify-js`.
Nothing requires that file — it is kept deliberately as the reference implementation
that ten comments across `public/scripts` cite by line number — but the
`./public/**/*.js` glob was shipping the entire Parse 1.5 SDK to the browser
(GHSA-wvh7-5p38-2qfc, GHSA-9f2h-7v79-mxw3). It stays in the source tree and stops
being served.

---

## What is left

### 1. jQuery Mobile 1.4.5 and jQuery 1.11.2 — no fix exists

GHSA-fj93-7wm4-8x2g (high, XSS) has a vulnerable range of `>=0`. jQuery Mobile is
EOL and archived; there is no patched version, and the entire UI is built on it.

The vendored file also carries **~124 lines of local patches** across three commits
(`6b790dc`, `c5f8d5e`, `a6c978e`) fixing the transition-lock and stale-route bugs.
Any replacement must port those forward — this is a UI rewrite, not a dependency bump.

jQuery is bounded by the same constraint. `public/scripts/app.js:11` loads **1.11.2
from the Google CDN** — that CDN copy is what executes, not the dormant vendored
1.12.4. Clearing its advisories (GHSA-jpcq-cgw6-v4j6, GHSA-6c3j-c64m-qhgq,
GHSA-gxr4-xjj5-5px2) needs jQuery ≥ 3.5.0, which jQuery Mobile 1.4.5 does not
support. Moving to the vendored 1.12.4 clears exactly one advisory and gains nothing
material — do not present it as a fix.

**The compensating control is a Content-Security-Policy header from `index.js`,**
restricting `script-src` to `'self'` plus the TrackJS origin with no `'unsafe-inline'`
for scripts. There is currently none. That is the highest-value mitigation available
while jQuery Mobile stays.

### 2. `dist/` is a pre-Parse-8 build, and rebuilding it is an owner decision

`dist/` is tracked (470 files) and stale: `dist/scripts/app.js` still maps
`parse:"parse-1.5.0"`, `underscore` and `backbone` to third-party CDNs that source no
longer trusts, and `dist/scripts/lib/parse-8.6.0.js` does not exist.

**Every browser-side fix above lands in `public/` only.** They reach production when
`dist/` is rebuilt and deployed — and because `dist/` is generated from source, that
same rebuild also ships the Parse 8 migration, which production has not taken. That
coupling is a deploy decision, so `dist/` was deliberately **left as it was**, apart
from deleting `dist/external/` (dead files, no functional risk).

The build was verified to work and to produce correct output — a fresh
`npx gulp greensboro` yields `parse:"parse-compat/parse"`, ships `parse-8.6.0.js`,
and contains no `js.cookie.js`, `parse-1.5.0.js` or `external/`. Rebuilding is a
`npx gulp greensboro` away when the migration deploy is wanted.

Consider whether `dist/` should be tracked at all.

### 3. Unpinned third-party origins (no advisory, real supply-chain risk)

`public/index.html:61` loads TrackJS from `releases/current/tracker.js` — a
**mutable** tag, with no SRI anywhere in the page (`grep -c "integrity=" ` → 0). The
bytes can change with no repo change and no review, on every page load of an
authenticated session. jQuery, bootstrap-datepicker and font-awesome load from three
more origins unpinned.

RequireJS-loaded scripts cannot carry an `integrity` attribute — the loader injects
bare `<script>` tags — so the fix for those is vendoring, as `app.js:17-29` already
argues for lodash and Backbone. The two `<link rel="stylesheet">` tags can take SRI
directly.

### 4. Vendored lodash 3.10.0 — deliberately not touched

`public/scripts/lib/lodash.js` is lodash 3.10.0, aliased as `underscore`. It carries
GHSA-jf85-cpcp-j695 (critical) and three highs.

**Exposure is lower than the CVSS implies, and the fix is larger than it looks.** The
critical's sinks are `_.merge` / `_.defaultsDeep` / `_.zipObjectDeep`, and a grep for
all three under `public/scripts/app` returns **zero hits**. Treat it as a real high,
not a live critical.

A straight swap to 4.17.21 still breaks both the app and its frameworks. Counted
under `public/scripts/app`, these were removed or renamed in v4:

| API | sites | v4 replacement |
|---|---|---|
| `_.contains` | 33 | `_.includes` |
| `_.select` | 4 | `_.filter` |
| `_.sortByAll` | 4 | `_.sortBy` with an array |
| `_.findWhere` | 2 | `_.find` |
| `_.any` | 2 | `_.some` |
| `_.pluck` | 1 | `_.map` |

Two things that *look* like breakage and are not, so nobody re-litigates them: all 8
`_.first` calls are single-argument (unchanged in v4 — it is an alias for `_.head`),
and both `_.max` calls pass a plain numeric array rather than an iteratee.

The harder half is that **the frameworks call the removed APIs themselves**, so the
shim has to be installed before they load, not just around app code: Marionette 2.4.7
uses `_.rest` (9 — semantics changed completely in v4, now rest-params rather than
drop-N), `_.invoke` (6 → `_.invokeMap`), `_.any` (1) and `_.contains` (1); Backbone
1.1.2 uses `_.invoke` (1) and `_.any` (1).

The workable route is the pattern `parse-compat/` already proved: vendor 4.17.21
alongside a small compat shim re-aliasing the removed APIs, then retire the shim
call-site by call-site. That needs a full Karma and Playwright run behind it —
`_.template` governs essentially every rendered view at 126 sites.

---

## Traps

Things `npm audit` actively recommends that must not be done.

**`npm audit fix --force` reverts the Parse 8 migration.** It offers
`parse-server@4.10.20` (and, once `ws` is pinned, `parse-server@3.0.0`) and
`parse@3.4.2`, both flagged `isSemVerMajor: true`. These are presented as fixes for
the `ws` and Google Cloud transitives. They are not fixes; they are the undoing of
the migration. Never downgrade `parse`, `parse-server` or `mongodb`.

**`npm audit fix` unforced is safe here** — it was used, and it touched no guarded
package — but check the dry run each time rather than trusting that it stays true.

**A clean `npm audit` does not mean the browser is clean.** The vendored libraries in
`public/scripts/lib/` are invisible to it. The npm `lodash` is 4.18.1 and clean while
the vendored one is 3.10.0; the npm `moment` was already 2.30.1 while the vendored one
was 2.10.6. Audit the files, not just the tree.

**Read the RequireJS `paths` config before recording a version.** The vendored
`jquery.js` is 1.12.4 but `app.js:11` loads 1.11.2 from a CDN. An inventory that
reads file headers records the wrong affected set.

**Do not price a major upgrade from its reputation.** The jimp migration was first
written off as expensive on the belief that 1.x had dropped remote-URL reading, which
`crop_and_thumb` depends on. Twenty minutes of probing the installed package against
a local HTTP server showed the feature intact and the whole migration mechanical.
Install the candidate in a scratch directory and exercise the specific APIs the code
uses; the answer is cheap and it is frequently the opposite of the expected one.
