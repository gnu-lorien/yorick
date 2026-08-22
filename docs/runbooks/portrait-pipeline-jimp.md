<!--
Written 2026-08-20 while investigating a reported intermittent failure of
assets-rename-portrait test 99 attributed to a server-side
"TypeError: Cannot read properties of undefined (reading 'bitmap')".

The attribution was wrong, and the reason it was wrong is the useful part.
-->
# The portrait pipeline, jimp, and the error that names nothing

**Short version.** `TypeError: Cannot read properties of undefined (reading
'bitmap')` in the server log is **expected on every single run** of
`assets-rename-portrait.spec.js`, and it says nothing about what failed. Do not
treat it as a symptom. It is now guarded (`cloud/main.js`), so what you will see
instead is a message naming the portrait's URL.

> **Superseded in part by Steps 12 and 13 — read [§7](#7-step-12-happened-which-of-the-above-held)
> and [§8](#8-step-13-happened-jimp-161-and-the-removal-that-was-not-one) before
> acting on anything above.** The jimp bump landed, and the TypeError this
> document is named after is gone. Sections 1–6 describe jimp **0.2.28** and §7
> describes **0.22.12**; the repo now ships **1.6.1**. They are kept because the old
> shapes are still what you will find in any run log older than 2026-08-21, and
> because §3's reasoning about misattribution is version-independent — §8 is that
> same mistake made again, about a feature removal that had not happened.

---

## 1. What actually happens

`crop_and_thumb` (`cloud/main.js`) fetches each uploaded portrait **back over
HTTP** from `publicServerURL` and hands the bytes to jimp:

```js
Image.read(portrait.get("original").url()).then(function (image) {
    var size = Math.min(image.bitmap.width, image.bitmap.height);
```

jimp 0.2.28 can settle that promise **with nothing, and call it success**:

```js
// node_modules/jimp/index.js
function throwError(error, cb) {
    if ("string" == typeof error) error = console.error(error);   // <-- returns undefined
    if ("function" == typeof cb) return cb.call(this, error);
    else throw error;
}
```

`console.error()` returns `undefined`, so a **string** error becomes `undefined`.
`Jimp.read`'s promise adapter is `if (err) reject(err); else resolve(image)` —
with `err` now falsy and `image` never passed, it **resolves with `undefined`**.
Every string-valued failure in jimp's URL branch goes this way, and both of that
branch's failure messages are strings:

- `"Could not find MIME for Buffer <url> (HTTP: n)"`
- `"Could not load Buffer from URL <url> (HTTP: n)"`

The next line then reads `.bitmap` off `undefined`. **The TypeError is the
symptom of an error jimp already had and threw away** — the real message went to
`console.error` and nowhere else, so it reaches the server log but never the
client, never the test, and never the Playwright report.

Measured against a local HTTP server, jimp 0.2.28 vs the 0.22.12 that
`s10-server-migration-plan.md` Step 12 targets:

| response | jimp 0.2.28 | jimp 0.22.12 |
|---|---|---|
| 404 + HTML | **resolves `undefined`** → TypeError | rejects `Error: HTTP Status 404 for url …` |
| 200, empty body | **resolves `undefined`** → TypeError | rejects `Error: Could not find MIME for Buffer <null>` |
| 200, JSON body | **resolves `undefined`** → TypeError | rejects `Error: Could not find MIME for Buffer <null>` |
| 200, truncated JPEG | rejects with a bare **String** | rejects `Error: unknown JPEG marker 0` |

Probe: `scratchpad/jimpprobe.js` in the session that wrote this; it is ten lines
and worth rebuilding rather than hunting for.

## 2. Why it fires on a healthy run

Test **124** uploads `portraittxt.txt` **on purpose** — it asserts that a
non-image upload is rejected and leaves the existing portrait intact. jimp
correctly cannot sniff a MIME for a text file, so it takes exactly the path
above. Every clean run of that spec therefore logs one
`Could not find MIME for Buffer <…_portraittxt.txt> (HTTP: 200)` and one
TypeError. **That is the feature working.**

The rejection was accidental rather than designed: nothing in `crop_and_thumb`
checked for a missing image, so a `TypeError` on the next line was what aborted
the `beforeSave`. It aborted for the right reason by the wrong route.

## 3. How the misattribution happened, and how to avoid the next one

Test 99 is the **rename form**. It touches no portrait at all, and every
`uploadCharacterPortrait` / `uploadTroupePortrait` call in the file is at a line
**after** it. The file is `mode: 'serial'`, so a failure at 99 means the portrait
tests never ran — the TypeError could not have come from this file's own uploads
in a run where 99 failed.

What almost certainly happened: 99 failed for an unrelated reason, and the
TypeError — present in the log of every run, healthy or not — was read as its
cause.

**The rule this gives you:** in this spec file, `bitmap` in the log is
background, not signal. Match on the *URL* in the accompanying
`Could not find MIME` line. If it ends `portraittxt.txt`, that is test 124 doing
its job.

## 4. What changed

`crop_and_thumb` now checks for the missing image and throws an error naming the
URL and pointing at the log line that carries the real reason. The behaviour is
unchanged — the save still aborts, test 124 still passes — but the failure now
identifies itself.

The guard is **correct under both jimp versions**, which is the shape worth
preferring here (see `parse8-migration-handoff.md`, "You have both ends of the
codebase"): under 0.22.x `Image.read` rejects properly and the guard never fires,
so it is not scaffolding to remove later.

## 5. What this means for Step 12

- **The upgrade fixes this class outright.** 0.22.x rejects with a real `Error`
  for all four failure shapes above.
- **Test 124 survives the change.** It asserts against
  `uploadCharacterPortrait`'s own thrown message (`portrait upload was rejected:
  …`, from the UI's surfaced error), not against the server's error text, so the
  message changing shape does not break it.
- **Expect the log to go quiet.** After the upgrade the TypeError disappears from
  healthy runs. That is the fix landing, not coverage disappearing — but it does
  mean "the bitmap error is gone" is not by itself evidence the upgrade worked.
- **The self-fetch is the real fragility, and it is untouched.** The thumbnail
  hook fetching the portrait back over HTTP from `publicServerURL` is a network
  round trip inside a `beforeSave`. Anything that makes that request return a
  non-image — a wrong `PUBLIC_SERVER_URL`, a file not yet readable, an auth
  response, a proxy error page — lands here. Under 0.2.28 that arrived as a
  nameless TypeError; it now arrives with the URL attached.

## 6. Still open

- **Test 99's actual flake is not root-caused.** It did not reproduce in the runs
  made here. Whatever it is, it is not this. If it recurs, capture its own error
  and ignore anything containing `bitmap`.
- **`request` is deprecated and reaches the network.** jimp 0.2.28's URL branch
  is `require('request').defaults({ encoding: null })`. Step 7 deletes the app's
  own unused `request` dependency; this transitive one only goes when jimp moves.

---

## 7. Step 12 happened: which of the above held

`jimp@0.2.28` → `jimp@0.22.12`, 2026-08-20. Everything below is measured against
the version actually installed in this repo, not against release notes.

### The predictions in §5, scored

| §5 said | Outcome |
|---|---|
| "The upgrade fixes this class outright — 0.22.x rejects with a real `Error` for all four failure shapes" | **Held.** Re-probed against the installed 0.22.12; table below. |
| "Test 124 survives the change" | **Held.** It asserts on `uploadCharacterPortrait`'s own `portrait upload was rejected: …` (`e2e/helpers/portraits.js:81`), never on the server's text. |
| "Expect the log to go quiet" | **Half wrong, and the useful half is the wrong one.** The TypeError is gone, but test 124 still writes exactly one expected error per run — the rejection, now carrying a real message. The log does not go quiet; it changes shape. |
| "The self-fetch is the real fragility, and it is untouched" | **Held.** `crop_and_thumb` still fetches the portrait back over HTTP from `publicServerURL` inside a `beforeSave`. Nothing in this step went near it. |
| §4: "the guard is correct under both versions … under 0.22.x it never fires, so it is not scaffolding to remove later" | **Held, and now demonstrated.** The `!image` branch is unreachable on 0.22.12. It was kept anyway — see below. |
| §6: "this transitive `request` only goes when jimp moves" | **Wrong.** jimp moved and `request` stayed. |

### The §1 table, re-measured on 0.22.12

Same probe, same five shapes, plus the `text/plain` case that is what test 124
actually sends:

| response | jimp 0.22.12 |
|---|---|
| 404 + HTML | rejects `Error: HTTP Status 404 for url <url>` |
| 200, empty body | rejects `Error: Could not find MIME for Buffer <null>` |
| 200, JSON body | rejects `Error: Could not find MIME for Buffer <null>` |
| 200, `text/plain` (test 124) | rejects `Error: Could not find MIME for Buffer <null>` |
| 200, truncated JPEG | rejects `Error: unknown JPEG marker 0` |
| 200, real image | resolves an image |

Every one is a real `Error`. On 0.2.28 the first three **resolved `undefined`**
and the truncated JPEG rejected with a bare **String** (`typeof e === 'string'`,
re-confirmed here before the bump). The whole throwError-eats-strings class is
closed.

**But one thing got worse, and `cloud/main.js` now compensates for it.** Note
what the middle rows lost: the **URL**. 0.2.28 at least printed
`Could not find MIME for Buffer <http://…/x_portraittxt.txt> (HTTP: 200)` to the
log before discarding the error; 0.22.12's message is `<null>` and names nothing.
That is precisely the property §4 added the guard to get back. So the read is now
wrapped in a `.catch` that re-throws with `original_url` prepended, and the
`!image` guard stays behind it as a contract check with a message that says it
should be unreachable.

### What did *not* change, and how that was proven

jimp is shared between `cloud/` (the code under migration) and
`e2e/helpers/images.js` (the harness that verifies it), so moving both together
leaves the portrait diff without an independent oracle. That was settled before
the repo was touched, by running the harness's own operations and the server's
own pipeline under both versions side by side against the three real fixtures:

- **Decode path — identical, bit for bit.** `Jimp.read` → `bitmap.data` →
  dominant colour: same width, height, opaque-pixel count, mean RGB, and the
  same SHA-256 of the raw bitmap, on all three fixtures. Every assertion in
  `assertImageColor` is therefore version-independent.
- **Thumbnails — identical, bit for bit.** The full `crop_and_thumb` /
  `create_thumbnail` chain (center crop → `getBuffer(MIME_JPEG)` → re-read →
  `scaleToFit` → `getBuffer(MIME_JPEG)`) produced byte-identical JPEGs at 32, 64,
  128 and 256 for all three fixtures — run both sequentially and, as
  `cloud/main.js` actually does it, with all four sizes started concurrently
  against one shared cropped image.
- **Fixture generation — same pixels, different container.** `new Jimp(w,h,c)` +
  `write()` yields a PNG 12 bytes shorter under 0.22.12: it emits the deflate
  stream as one IDAT chunk where 0.2.28 split it across two. The inflated
  scanlines are byte-identical. The three fixtures are committed and reused when
  present, so nothing regenerates them in a normal run; noted in
  `e2e/helpers/images.js` for whoever deletes one.

So the shared-dependency problem was real in principle and empty in fact: there
was nothing for both halves to break in the same direction, because neither half
changed its output.

### Two API details worth knowing before Step 13

- **`crop` used to leave the buffer oversized.** On 0.2.28, cropping 320×240 to
  240×240 set `bitmap.width/height` correctly but left `bitmap.data` at the
  original 307,200 bytes — 76,800 bytes of stale tail past the image. 0.22.12
  reallocates to exactly `w*h*4`. The first `w*h*4` bytes are identical in both,
  which is why the encoders never noticed and the thumbnails match. Anything that
  reads `bitmap.data.length` after a crop was quietly wrong before and is right
  now; nothing in this repo does.
- **`getBuffer` is a per-instance own property on 0.22.x**, not a prototype
  method — `typeof Jimp.prototype.getBuffer === 'undefined'` while
  `typeof image.getBuffer === 'function'`. Every call site here calls it on an
  instance, so this is inert, but it will surprise anyone who probes the class.

### `request` did not leave

§6 predicted the deprecated transitive `request` would go when jimp moved. It
did not. jimp 0.22.12 fetches over `phin`/`centra` and no longer contributes it —
but `request` is still in the tree, twice, from `parse-server@2.8.4` itself:

```
parse-server@2.8.4
├─ request@2.85.0
└─ @parse/push-adapter → @parse/node-gcm → request@2.88.0
```

It goes at Step 13 or not at all.

### Non-jimp collateral, checked

`npm install jimp@0.22.12` also removed `node_modules/bcrypt@3.0.0` from disk.
It is an **optional** dependency of parse-server, unchanged in the lock before
and after; npm was reconciling disk to the lock, not resolving differently.
It was already dead weight: `bcrypt@3.0.0` cannot build or load on node 24
(node-pre-gyp fails, `require` throws), so `parse-server/lib/password.js` — which
is `var bcrypt = require('bcryptjs')` with a `try { require('bcrypt') }` upgrade —
has been on `bcryptjs` all along. Hashes are unaffected either way; the two are
format-compatible, and Step 10 already pointed the seeder at `bcryptjs` directly.

The 18 other version moves in the lock are all inside jimp's own closure
(`jpeg-js`, `pngjs`, `bmp-js`, `file-type`, `phin`, `load-bmfont`, `xml2js`,
`sax`, …). `aws-sdk` keeps its own nested `xml2js@0.4.19` and `sax@1.2.1`, so the
root moves reach nothing outside jimp. Pre-existing `npm ls` complaints
(`ip-address@10.5.0 extraneous`, `socks@2.3.3 invalid`) are byte-identical in the
lock before and after and are not from this step.

---

## 8. Step 13 happened: jimp 1.6.1, and the removal that was not one

Driven by security, not by the pipeline: **GHSA-5v7r-6r5c-r473**, an infinite loop
in the `file-type` ASF parser, reachable because `crop_and_thumb` feeds
user-uploaded bytes to `Image.read`. It could not be fixed by pinning `file-type`
forward — the fixed line (>= 21.3.1) is ESM-only and `@jimp/core@0.22.12` is CJS —
so the only route was the major. jimp 1.6.1 carries `file-type@21.3.4` and audits
clean.

### The claim that nearly stopped this, and was false

The migration was initially scoped as expensive on the belief that **jimp 1.x
removed remote-URL reading**, which §1 shows this pipeline is built on. That is
wrong. Measured on 1.6.1 against a local HTTP server:

| input | 1.6.1 result |
|---|---|
| `Jimp.read("http://.../img.jpg")` | resolves, correct dimensions |
| 404 | rejects, `"HTTP Status 404 for url ..."` |
| `text/plain` 200 | rejects, `"Could not find MIME for Buffer <null>"` |
| empty 200 | rejects, `"Could not find MIME for Buffer <null>"` |
| JSON 200 | rejects, `"Could not find MIME for Buffer <null>"` |

Those are the **same two message shapes** §7 measured on 0.22.12, so
`crop_and_thumb`'s `.catch` re-attaching the URL, and the `!image` guard this
document is named after, both survive the upgrade unchanged. The lesson is the one
§3 makes about misattribution, in a new costume: probe the installed package before
pricing the work from its reputation.

### The §7 table, re-measured on 1.6.1

| | 0.22.12 | 1.6.1 |
|---|---|---|
| module shape | `require("jimp")` **is** the class | `{ Jimp, JimpMime, rgbaToInt, intToRGBA, ... }` |
| MIME constants | `Jimp.MIME_JPEG` | `JimpMime.jpeg` — same `"image/jpeg"` string |
| `getBuffer` | `(mime, cb)`; per-instance own property | `(mime)` returning a promise; a real prototype method again |
| `scaleToFit` | `(w, h, cb)` | `({ w, h })`, mutates and returns `this` |
| `crop` | `(x, y, w, h)` | `({ x, y, w, h })` — positional is **rejected** by a zod schema, not merely deprecated |
| construction | `new Jimp(w, h, color, cb)` | `new Jimp({ width, height, color })` |
| `write` | `(path, cb)` | `(path)` returning a promise |
| colour helpers | `Jimp.rgbaToInt` | top-level `rgbaToInt` |

§7's note that `getBuffer` is an own property rather than a prototype method is **no
longer true** on 1.6.1: `typeof Jimp.prototype.getBuffer === "function"`. Anyone
probing the class will now find what they expect.

### What did not change

- **Pixels.** The committed fixtures, written by 0.2.28, still decode to the colours
  the assertions expect. A fixture regenerated on 1.6.1 is 12 bytes smaller with
  identical pixels — the same delta `makeFixturePng`'s comment already records for
  the 0.2.28 to 0.22.12 move.
- **The buffer round trip in `create_thumbnail`.** It still looks redundant and still
  is not: `scaleToFit` mutates, all four sizes are built concurrently from one
  `input_image`, and decoding a fresh instance per size is what keeps them from
  resizing each other.
- **The scaffolding did go.** `getBuffer` and `write` returning promises, and
  `scaleToFit` returning `this`, made all four hand-rolled callback-to-promise
  wrappers dead weight. They were deleted, not translated.

### §6's last open item, closed

§6 predicted the deprecated `request` transitive would leave when jimp moved, and §7
recorded that it had not — it was coming from `parse-server@2.8.4` twice, and would
"go at Step 13 or not at all." **It is gone**, but not from this step:
`parse-server@9.10.0` does not depend on it at all. `npm ls request` is empty and
`node_modules/request` does not exist.

### Verification

`npm run test:e2e:assets` — **30 passed**, covering the center crop, all four
thumbnail sizes, and the non-image rejection path of test 124.
