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
