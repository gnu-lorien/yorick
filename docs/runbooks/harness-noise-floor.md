# The noise floor: what it was, and where it actually sits now.

> **Correction, same day.** The first version of this file said the noise floor
> is zero, on the strength of three consecutive double-runs. A fourth
> double-run, on a change that turned out to be innocent, then produced
> 2 NEW-FAIL (tests 49 and 114) followed immediately by a clean run of the
> identical code. So the honest figure is **low but not zero: roughly one bad
> run in seven**, concentrated in the same two tests. Everything below about
> root causes still holds; the claim of a hard zero did not survive contact
> with a seventh run. Treat a single clean diff as encouraging, not as proof,
> and re-run before believing a small NEW-FAIL count.


> **Second correction, 2026-08-19.** Re-measured across five consecutive
> eight-worker runs at the end of the parse@8 work (`runs/m17` … `m20`, plus a
> four-worker `m16`). One run was completely clean — `m18`, 447 same-pass, 0
> NEW-FAIL — and every other failure in those five was test 49 or test 114,
> never anything else.
>
> The useful new datum is that **test 49 fails with a byte-identical signature
> on both stacks**. `runs/candidate.json`, `runs/vendor.json` and `runs/w4a.json`
> were recorded on the LEGACY stack, and all three carry exactly
> `expect(received).toBe(expected) // Expected: 2, Received: undefined` at
> `admin-referendums.spec.js:452:45` — the same string `m17` and `m20` produce
> under parse@8. In those legacy runs 49 and 114 failed as a pair; under
> parse@8 they have been failing singly. So this is the harness, not the SDK,
> and the migration did not change it.
>
> Rate on a machine that had been running suites back to back for six hours:
> roughly one in three, which is worse than the one-in-seven above and is
> probably what sustained load does to it. On a quiet machine, treat
> one-in-seven as the figure and re-run.

> **Resolved, 2026-08-20.** Root-caused and fixed in `6b790dc`. It was one
> defect, not four flaky tests: jQuery Mobile closes every open popup on
> `pagebeforechange`, the routes ask for the page they are already showing, and
> that no-op request gets queued behind a running animation and replayed a fifth
> of a second later — landing, in the failing runs, 61 ms into a dialog's life.
> jQuery Mobile's own guard for this (`this._myUrl !== toUrl`) is dead code here,
> because `main.js` turns off hash listening so Backbone can own the URL, so
> `_myUrl` is never assigned. See the commit message for the traced timeline.
>
> Measured, same method as the numbers above:
>
> | | before (`c390d1f`) | after (`6b790dc`) |
> |---|---|---|
> | `xp-history` alone | 9 of 10 runs FAILED | **0 of 40** |
> | full 8-worker runs | 2 of 7 clean | **2 of 2 clean** |
>
> The 40 single-file runs are two independent agents' 20 each, on separate ports.
> 0 of 40 puts the 95% upper bound on the residual rate at about 7%; it does not
> prove zero, and nobody should claim it does — the honest statement is that the
> ~90% single-file rate and the 5-of-7 full-run rate are both excluded.
>
> **The four numbers were one bug.** 54, 75, 114 and 360 all sat in the same
> place: a dialog destroyed between the fill and the submit, by a navigation
> nobody asked for. That is why fixing the leak, the locator disagreement, the
> sweep and the deferred render each helped and none of them cured it — all four
> were real defects on the same page, and none of them was this one.
>
> **Still open, and deliberately not fixed here:**
> - The redundant navigation itself. `mobileRouter.js:448` and ~74 siblings still
>   ask jQuery Mobile for the page already on screen; it is now harmless, but it
>   is what made this reachable. A `show_page()` guard would remove it at source.
> - A `#popupEditLogin-popup` container leaks one duplicate-id element per full
>   render of the experience page, because `enhanceWithin()` re-creates it and
>   the sweep from `1b24a57` only knows about the three XP popups.
> - `traits-lifecycle` 270 went flaky once in the two post-fix full runs and
>   self-healed on retry. Different file, different assertion (a DevTools-only
>   console check), no popup involvement — a separate, smaller thing.
> - `assets-rename-portrait` 99 failed once during verification with a
>   server-side `TypeError: Cannot read properties of undefined (reading
>   'bitmap')`. That is the jimp path, and it is the oracle S10 Step 12 depends
>   on, so it wants understanding before that step rather than after.


> **Third correction, 2026-08-20, S10 Step 2.** Both corrections above understate
> this, and the way they understate it is the reason it matters. They count
> *failures*; the number that decides whether a migration can be measured is the
> count of tests that stop producing a verdict.
>
> Measured across every recorded eight-worker run of unchanged code
> (`m16`–`m20`, `s10-baseA`, `s10-baseB`):
>
> | run | failed | coverage lost to its serial tail |
> |---|---|---|
> | m16 | 114 | 14 |
> | m17 | 49 | 4 |
> | m18 | — | 0 |
> | m19 | 114 | 14 |
> | m20 | 49 | 4 |
> | s10-baseA | — | 0 |
> | s10-baseB | 114 **and 54** | 36 |
>
> **Two of seven runs are clean, not six of seven.** The earlier figure counted
> the runs that were declared clean during the browser phase, when a NEW-FAIL
> count of 1–2 was read as "the known flakes" and waved through. It is the same
> data; what changed is that the gate now counts the tests each flake *strands*
> rather than the flakes themselves.
>
> **The cost is not one test, it is the serial tail.** 17 of 21 spec files are
> `mode: 'serial'`, so a failure aborts the rest of its file. Test 114 takes 14
> tests with it, test 54 takes 22, test 49 takes 4. `s10-baseB` reports 2
> failures and loses 38 tests — 8.5% of the suite going dark while the headline
> number says "2".
>
> **Test 54 is not fixed.** `parse8-remaining-queue.md:85` records it as
> "load-sensitive before it was fixed". Measured on a 32-CPU box with 43 GB
> free, no orphaned processes, and the file running *alone* on one worker:
>
> | attempt | result |
> |---|---|
> | s10-baseB, 8 workers | FAIL |
> | heal-xp, 1 file alone | FAIL, and FAIL again on the retry |
> | heal-xp2, 1 file alone | PASS, 23/23, 41s |
>
> Three failures and one pass with less load than the runs it was said to need.
> Whatever 54 is sensitive to, it is not machine load, and the isolation runs
> rule out worker contention as the mechanism.
>
> **The mechanism is the popup lifecycle, not the harness.** Every failure lands
> in `submitActivePopup` (`e2e/helpers/jqm-helpers.js:292`) with the same shape:
> the submit button *resolves*, then oscillates `not stable` → `not visible` for
> the full 20s. Playwright's `click()` already auto-waits for visible, stable and
> enabled, so this is not a missing wait in the test — the element is being torn
> down and rebuilt underneath the click. `jqm-helpers.js:265-275` records the app
> side directly: "4 to 7 copies of `#popupEditReason` can be live at once", and
> "fixing that did NOT stop `xp-history` 75 being flaky, so it is not the whole
> story."
>
> Tests 54, 75, 114 and 360 are the same defect wearing four numbers, and it is
> in `CharacterExperienceView` and the jQuery Mobile popup teardown — code this
> migration changed. Commits `1b24a57`, `eeebc30`, `8ac6ac0` and `3f5813e` each
> took a piece of it. It is not finished.
>
> **Consequence for S10.** The differential is the entire strategy for the server
> phase, and a clean full run is currently the exception rather than the rule. A
> server change measured against this harness produces an ambiguous answer more
> often than a trustworthy one. The gate reports this honestly — stranded
> coverage exits 3, never 0 — so nothing is silently lost; the cost is paid in
> re-runs instead, and the plan's 25–36 run budget does not include them.


**Measured 2026-08-18 on `claude/office-hours-upgrade-plan-092d60`.**

Two consecutive double-runs of the full suite, each diffed against its own pair
with `diff-runs.js`, both reporting **0 NEW-FAIL / 447 same-pass**. One of the
four runs was completely clean: 447 passed, zero flaky.

| | before | after |
|---|---|---|
| Passed | 421-431 | **447** |
| `same-fail` (114) | 1 | **0** |
| Noise floor (`NEW-FAIL` on an unchanged diff) | 2 | **0** |
| Suite wall clock | 6.5m | **4.2m** |

## Why it took three sessions

Two reasons, both worth remembering.

**The diagnostics were on the wrong lines.** 355b's elaborate table-state
diagnostic wraps the *re-render* wait. The test dies on the *hash* wait above
it, so in every failing run captured, that diagnostic never once executed. The
same was true of 75: `waitForJqmPopup` grew a detailed failure report, and the
failure had already moved to the submit click below it. Instrumentation was
added three times without first checking which line the error came from.

**The trigger kept being fixed instead of the consequence.** `hardReload()` in
`openLog`, `emptyGrace` polling, the transition-queue drain in `a6c978e` — each
removed one way to *reach* the bug. None of them made the bug survivable.

## What the bug was

`transition()` in jQuery Mobile takes `isPageTransitioning` and only gives it
back from the `.done()` of the transition promise, which resolves off CSS
animation callbacks. Those callbacks do not fire when the animating element is
replaced mid-flight — which is exactly what a Backbone or Marionette view does
when it re-renders into a page during a transition. The promise never settles,
`_releaseTransitionLock` is never reached, and the flag stays true for the life
of the page. From then on every `changePage` is pushed onto
`pageTransitionQueue` and nothing is left to drain it.

One stuck boolean produced three unrelated-looking failures:

| Test | Symptom | Same cause |
|---|---|---|
| 114, 360 | hash updates, active page never changes | queued `changePage`, never drained |
| 75 | `popup("open")` silently dropped | jQM still believes a page change is in progress |
| 355b | Next button navigates to page 3 instead of page 1 | see below — related but distinct |

355b had its own defect on top. Traced live:

```
register:enter  hash=/log/0/10  argStart=0   selfStart=0
render          start=0   rows=10
register:enter  hash=/log/0/10  argStart=20  selfStart=0   <- stale, 9ms later
render          start=20  rows=10                          <- page 2 under a page-0 URL
domClick        hash=/log/0/10
next:enter      start=20                                   <- reads the poisoned value
next:hashSet    start=30  hash=/log/30/10
```

A reload replays whatever hash the document loaded with, and the explicit
navigation after it adds a second registration. Both start async fetches, so
the later-resolving one wins even when it is stale. `next()` then paged from a
phantom position.

Both halves are user-visible, not test-only: the table renders a page the URL
does not name, and Next pages from it.

## The fixes

- `42d8edc` — `CharacterLogView.next()`/`previous()` compute from the hash, not
  from memoised state, and `register()` drops a call the URL has moved past.
- `c5f8d5e` — the jQuery Mobile transition lock self-heals after 8s, and the
  stale-route guard also fires when the log is no longer the current route at
  all (the first version was gated on `isLogRoute()` and so did nothing in the
  rename case, which is the one that mattered).

## Still open

**Test 75 recovers but is not root-caused.** It still fails its first attempt in
roughly half of full-suite runs and passes on retry, so it no longer registers
as a regression — but "passes on the second try" is not fixed. The watchdog
bounds the damage; it does not explain why the popup is dropped in the first
place. The prior session disproved three explanations by measurement
(`test_timing_report.md` §5a); the transition-lock hypothesis it ended on is now
confirmed as *a* mechanism, and whether it is the only one is unproven.

**The general rule, now partly applied.** `Parse.history.start()` re-dispatches
the loaded hash on every reload (`parse-1.5.0.js:9329`, no `silent`), and route
handlers in `mobileRouter.js` commit their async results — view state, view
data, page transitions — into memoised singleton views without checking whether
their route is still current.

`1119dfc` adds `_routeGeneration` (bumped per dispatch via a `route()` override)
and `ifCurrent()`, and applies it to **12 of the ~35 `get_character` handlers**.

What is still unguarded, and why:

- **The 20 `.then()` chains**, including `characterhistory`, `characterapproval`
  and `characterrename`. A guard there returns `undefined` and breaks the chain
  for everything downstream; `.done()` discards its return value, which is why
  those were safe. Doing these properly means moving the check to each chain's
  final commit.
- **`.always()` and `.fail()` are deliberately never guarded.** `.always()` hides
  the loading spinner; skipping it strands the spinner on screen. This also
  rules out the tidier-looking approach of gating the promise `get_character`
  returns.
- **Test 49's `referendumView`** is the same shape and is not covered. It is
  currently green, but by luck rather than by repair.

## Re-running the gate

```bash
E2E_RUN_NAME=a npx playwright test
E2E_RUN_NAME=b npx playwright test
npm run test:diff -- runs/a.json runs/b.json
```

Must report **0 NEW-FAIL**. That is the harness being quiet against itself, and
it is the precondition for trusting any migration diff.
