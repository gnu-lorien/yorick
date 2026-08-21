<!--
Rewritten 2026-08-19. The original version of this file was a work queue for
the 18 regressions in `runs/parse8s.json`, produced by a parallel diagnosis
pass. All 18 are gone; the suite now matches the legacy baseline exactly. What
follows is what those 18 actually turned out to be, because the shape of the
answers is worth more than the list was.
-->
# Parse@8 regressions: what they were

**Status: 0 NEW-FAIL, 447 same-pass against `runs/baseline.json`.**
`runs/m18.json`, eight workers, the default configuration the baseline was
recorded under. Confirmed by re-run.

The starting point was 67 passing / 18 regressions. Seventeen commits later
every one of the 447 baseline tests passes, and the diff is clean.

---

## The shape of it

Almost nothing here was a missing method. The compatibility layer already had
the big surfaces — `Parse.Promise`, `Parse.Collection`, change events, the
router. What was missing was **behaviour around the edges of those surfaces**,
and it was missing in a way that never raised an error:

| what was wrong | how it presented |
|---|---|
| collections stored decoy clones of every object | junk fields PUT to real rows; XP arithmetic went NaN |
| three venues shared one class identity | picking "Vampire" created a Changeling |
| queries forgot which class they were built from | Changeling cost rules applied to a vampire |
| `addUnique` dropped its `options` argument | a `{silent: true}` add re-rendered mid-save and threw |
| objects were single-instance | every `x !== self.x` re-render guard silently went false |
| no `saved` event | the creation wizard's pool counters never moved |
| a save response unfetched what it echoed | a trait edit reported success and did nothing |
| no `changes` hash on the change event | joining a troupe bounced the hash back, silently |
| no `destroy` event | deleted rows stayed on screen |
| `.fail` handlers recovered the chain | the redirect after a denied read never ran |

Ten of those are the same failure mode: **something stopped happening, and
nothing said so.** That is why the count of *passing* tests moved so much more
than the count of *failing* ones for most of the session — 67 → 138 → 198 →
274 → 333 → 447, while NEW-FAIL crawled 18 → 16 → 15 → 12 → 7 → 0. A single
early defect was hiding hundreds of tests behind it.

## What actually found them

**Reading `parse-1.5.0.js` beat reasoning about promises, every time.** The two
largest finds of the session were both places where the layer had implemented
what promises *ought* to do:

- `.fail(cb)` was recovering the chain, "exactly as `.catch` does natively and
  as the original Parse.Promise did". It did not. 1.5 ships
  `_isPromisesAPlusCompliant: false` (`:3892`), nothing turns it on, and in
  that mode the rejection branch ends at `promise.reject(result[0])` (`:4126`).
  The note in `promise.js` claiming the `.always(...).fail(...)` chains in
  `mobileRouter` were dead code was wrong, and derived from the same
  assumption.
- 1.5's constructor ran `this.set(attributes, {silent: true})` (`:4526`), and
  `_validate` returns early when silent (`:5917`) — so construction never
  validated. parse@8's does, and a `free_value: undefined` that had been
  harmless for years started throwing "Can't create an invalid Parse Object"
  from inside a click handler.

**The failing line is not the interesting line.** `update_trait` reported
success on an edit that never reached the server. The batch body was the
evidence: `POST /parse/1/batch` carried the character's own PUT and nothing
else. `unsavedChildren` indexes by `className + ":" + id` and skips anything
seen (`parse-8.6.0.js:43065`), the creation record's `<pool>_picks` hold their
own clean instances of the same rows, and they are walked first.

**Four of the last six were not Parse at all.** Once the model layer was right,
what remained were rendering races the legacy stack happened to win: a troupe
page that blanked its staff region on every re-render, three picker routes that
showed a spinner nothing hid, a completion route whose redirect ran outside its
own guard, and an XP table that rebuilt itself out from under an open dialog.
All four are real defects for a player, not just for the suite — the last one
loses what you were typing.

## Where the remaining risk is

- **The noise floor is unchanged: ~1 bad run in 7, in tests 49 and 114.** See
  `harness-noise-floor.md`. `runs/m17.json` is an example — a single NEW-FAIL
  in test 49, clean on the immediately following run of identical code. Re-run
  before believing a small count.
- **Test 54 was load-sensitive before it was fixed**, passing at four workers
  and failing at eight. If a test ever behaves that way again, that asymmetry
  is the diagnosis, not a mystery: something is re-rendering underneath an
  interaction.
- **`Character.js:242-245` still swallows save failures.** It was not the cause
  of any of the 18, but `.fail(function (errors) { PromiseFailReport(errors); })`
  now leaves the chain rejected rather than resolving it, which is the 1.5
  behaviour — worth re-reading that call site with fresh eyes.
- **`Character.js:918`, `delete self.attributes.troupes`,** is still a no-op:
  `attributes` is a getter in parse@8 and the file has no `"use strict"`.
  Adding one later would turn it into a TypeError. Drop the line instead.

## Next

`S10`, untouched: `cloud/main.js` still has 13 Cloud functions and 14 hooks on
the `(request, response)` signature parse-server 3.0 removed, 60
`response.success`/`response.error` calls and 37 legacy-promise uses. Then
parse-server 2.8.4 → 9.10.0, node-side `parse` 1.11 → 8.6, MongoDB 8.2.6
in-memory, `jimp` 0.2 → modern, and replacing `request`.
