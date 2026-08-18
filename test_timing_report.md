# Why the E2E suite hits 20-second timeouts

*A measurement report. Question asked: "I'm not sure what would take that long in this
application."*

## The short answer

Nothing does. No operation in this application takes twenty seconds, or anything close to
it.

Every timeout in this suite that has fired is a **wait that never completes**, not a slow
one. Twenty seconds is only the moment we stop waiting. In the one failure captured with a
full trace, the application performed 26 operations in **1.8 seconds total** — the slowest
single one being **1.02 seconds** — while a 27th wait sat there until it gave up.

The remaining question is *why* a wait never completes, and that is not fully answered. One
real defect was found and fixed — two helpers disagreed about which DOM element counts as
"the popup that is open" — but fixing it did **not** stop the flake. What the evidence now
points at is a popup that opens and then closes again before the next step can act on it.
That is still "stuck, not slow", but the mechanism is not yet pinned down.

## How this was measured

Four independent sources, in increasing order of usefulness:

1. Per-test durations from a full run under the JSON reporter (442 executed tests).
2. A Playwright trace of an actual failing attempt, which records every action and its
   duration.
3. A controlled experiment raising the relevant timeout from 15s to 90s.
4. Reading the two helpers against each other.

## 1. The duration distribution: this is a narrow band, not general slowness

Slowest individual tests, 6-worker run:

| Duration | Test |
|---|---|
| 22.5s | `troupes` 132 — create and fully complete a Vampire |
| 21.9s | `xp-history` 75 — every XP notation add/edit/delete |
| 21.5s | `lifecycle-werewolf` 355b — log Next button |
| 19.1s | `troupes` 134 — create and complete a Changeling |
| 18.9s | `troupes` 133 — create and complete a Werewolf |
| 18.7s | `approvals` 96 — AST from another troupe cannot approve |
| 16.5s | `approvals` 95 — stranger cannot open approval |
| 16.2s | `long-texts` 286 — long texts on printable sheets |
| **11.3s** | **← cliff. Everything else is below this.** |

**Only 3 tests out of 442 exceed 20 seconds**, and there is a sharp cliff after the eighth.
This is not a suite that is broadly slow.

The three at the top are also not the same kind of thing, which matters:

- `troupes` 132/133/134 drive an entire character-creation wizard end to end. They are long
  because they do a great many things, each of them fast. **Nothing is wrong with these.**
- `xp-history` 75 and `355b` are long because a single wait inside them hangs. These are the
  real subject of this report.

## 2. What a failing test actually spends its time on

From the trace of a failed `xp-history` 75 attempt:

| | |
|---|---|
| Actions performed | 27 |
| Sum of all action time | 16.8s |
| The one failing action (`waitForJqmPopup`) | **15.0s, timed out** |
| The other 26 actions, combined | **1.8s** |
| Slowest of those 26 | **1.02s** |

Those 26 include the character-sheet render, the jQuery Mobile page-active waits, and the
Parse queries — all sub-second. The application is fast. One wait is stuck, and it accounts
for 89% of the test's runtime on its own.

## 3. Slow, or stuck? The decisive experiment

These two look identical from the outside, and telling them apart is the whole question:

- If the popup is **slow**, a bigger timeout makes it pass.
- If the popup is **stuck**, a bigger timeout changes nothing.

This distinction has already cost this project once: a `~41s` timing note in
`long-texts.spec.js` recorded a transition as "slow" when the route was in fact never
completing at all, and the 41s was a fallback recovering. That mis-measurement stood for
some time. So it was worth doing properly rather than assuming.

**Experiment.** Raise the popup timeout from 15s to 90s, instrument the wait to log any
occurrence over 2s, and run the whole suite so the machine is genuinely loaded.

**Result.** Not one popup wait exceeded 2 seconds anywhere in the run — and the test *still
failed*, at a different step (`fillInActivePopup`, 10s). Nothing was slow. The wait simply
never completed.

**Verdict: stuck, not slow.** Raising timeouts is not the fix and never was.

## 4. Root cause: two definitions of "the open popup"

`jqm-helpers.js` decides "is the popup open?" and "which element is the popup?" in two
places, and they did not agree.

**`waitForJqmPopup`** — asks whether *any* copy of the popup is genuinely open:

```js
Array.from(document.querySelectorAll(sel)).some((popup) => {
  const container = popup.closest('.ui-popup-container');
  return !!container &&
         container.classList.contains('ui-popup-active') &&
         container.offsetParent !== null;
});
```

**`activePopup`** — picks the element everything afterwards is scoped to:

```js
return page.locator(`${popupSelector}:visible`).last();   // no ui-popup-active check
```

The first checks `ui-popup-active` on the container. The second checks only `:visible`, and
takes `.last()`. This matters because **duplicate popups exist** — the helper's own comments
say so, warning that "bare id selectors match stale duplicates left behind by earlier
renders."

So with a stale duplicate in the DOM, the sequence is:

1. `waitForJqmPopup` passes — satisfied by copy A, which jQuery Mobile really did open.
2. `activePopup` returns copy B — `:visible` enough to match, but not the opened one.
3. Every later step waits on copy B's input or submit button, which will never become
   visible, because nothing is going to open copy B.
4. The wait burns its whole budget and we call it "the popup took 20 seconds".

That is also why the failure moved between steps across runs — 15s at `waitForJqmPopup`,
20s at the submit click, 10s at the field fill. All three are the same defect surfacing
wherever the timing happened to land.

The file already had the correct predicate as a constant, `ACTIVE_POPUP`
(`.ui-popup-container.ui-popup-active:visible`), and used it — but only on the branch where
no popup is named.

## 5. The fix — necessary, but not sufficient

Scope the named-popup branch to the container jQuery Mobile actually opened, so both
functions share one definition:

```js
return page.locator(`${ACTIVE_POPUP} ${popupSelector}`).last();
```

Note what this is *not*: no timeout was raised, no retry added, no wait lengthened.

**It did not fix the flake, and that is worth stating plainly rather than burying.**
`xp-history` 75 passed 23/23 when its file was run alone — but a full-suite run afterwards
still showed it flaky (failed once, passed on retry). A single-file pass was not evidence of
a fix, and treating it as one would have been the same mistake this report is about.

The fix is kept because it is correct on its own merits: the two helpers genuinely did
disagree, and a locator that can select a copy other than the opened one is a latent defect
whether or not it is *this* failure. But the flake has a second cause.

## 5a. What the evidence now points at

After the scoping fix, the failure moved to `fillInActivePopup` waiting for `#reason-input`
inside a **correctly scoped** active popup — and timing out at 10s.

DOM snapshots from that failure's trace show:

- Duplicate popups are real and plentiful: **4–7 copies** of `#popupEditReason` and **2–3**
  of `#reason-input` in the document at once.
- One snapshot shows the popup genuinely open — one container carrying `ui-popup-active`.
- Later snapshots show copies still present with **no** active container.

Read with care — Playwright frame snapshots are incremental, so an absence in one frame is
not proof of removal. But the shape is consistent: the popup **opens and then closes again**
before the field can be filled. Our locator is scoped to active popups, so once it closes
there is nothing to match, and the wait runs out its budget.

That is a different failure from the one in §4, and it is not a timing budget problem
either: a popup that has closed will not reopen no matter how long we wait.

## 5b. Three explanations, measured and disproved

Each of these was plausible from reading the code. Each was tested and is wrong. Recorded so
nobody spends the time again.

| Hypothesis | How it was tested | Result |
|---|---|---|
| A late re-render closes the open popup | Delayed the save response by 3s to force the propagation render to land while the popup was open. Watched it land at exactly 3.0s. | **Disproved** — popup survived, input stayed visible for 6s |
| `popup("close")` closes the wrong copy | Submitted after a render had inserted a new copy, then counted active containers | **Disproved** — active went cleanly to 0; the next open was clean |
| Duplicate copies confuse the locator | Fixed the leak (below); copies now bounded at 1–2 | **Disproved** — flake persists with duplicates gone |

The reason a re-render does not destroy the open popup is worth knowing: jQuery Mobile moves
an opened popup's container out to the page element for positioning, so it is no longer
inside the region `render()` replaces.

## 5c. A real defect found on the way: the popups leak

Not the flake, but real and now fixed.

All three edit popups live inside `CharacterExperienceView`'s template, so every `render()`
emits fresh copies. Because jQuery Mobile has moved any *opened* copy out to the page, that
copy survives the replacement and a new one is added beside it — **one more element carrying
a duplicate id on every render**, growing without bound for as long as the page is open.
Measured: **seven** `#popupEditReason` elements after three edits.

That matters beyond the tests, because the view's own handlers reach for these popups with
bare `$("#popupEditReason")` selectors, which take whichever copy comes first in the
document rather than the one on screen.

`render()` now drops stale popup containers before replacing its markup, leaving any
currently *open* popup alone — destroying that would take the dialog away from whoever is
typing in it. Copies are bounded at 1–2 and no longer grow.

**It did not cure the flake.** Stated plainly because the temptation is to assume it did.

## 5d. Where this stands, and what the next occurrence will tell us

The failure has now appeared at three different waits — `waitForJqmPopup` (15s),
`fillInActivePopup` (10s), and the submit click (20s) — moving as its surroundings changed.
The most recent run puts it back at `waitForJqmPopup`: **the popup simply does not open**,
with duplicates ruled out.

Rather than guess a fourth time, `waitForJqmPopup` now reports the DOM state on timeout:
copy count, how many sit in an active container, whether jQuery Mobile already thinks a
popup owns the screen (`$.mobile.popup.active`), the active page id, and whether the loader
is up. At roughly one failure in three runs, a bare timeout costs a whole run to learn
nothing; this makes the next occurrence self-explaining.

The live hypothesis it is designed to test: jQuery Mobile refuses or defers a `popup("open")`
issued while it considers another popup active or a page change in flight — which would make
this the same *shape* as the transition-queue defect fixed in this branch, a jQuery Mobile
event dropped rather than delayed. That is a hypothesis, not a finding.

## 6. Still open: `lifecycle-werewolf` 355b

355b is a **separate** problem and is not fixed by the above. Its failure is a
`page.waitForFunction` timing out at 20s waiting for the log table to re-render after the
Next button is clicked — no popup involved.

Its history is worth stating plainly, because it has been misread twice:

- It was pinned `test.fail()` and filed with the R28/R33 swallowed-`changePage` family.
- The jQuery Mobile transition-queue fix made it pass in isolation, reliably, where it had
  previously never passed. It was un-pinned on that basis.
- It then failed under load, twice. So the fix is real but the test is **timing-marginal**,
  not settled.

It stays un-pinned — re-pinning as `test.fail()` would now fail on every good run — but it
should be treated as a watch item, not a pass. Given the evidence above, the right next step
is to determine whether its re-render is *stuck* or *slow*, using the same 90s method rather
than assuming.

## 7. There is no single "20-second boundary"

Worth knowing, because the failures hit three different knobs:

| Knob | Value | Where |
|---|---|---|
| Test timeout | 120s | `playwright.config.js` |
| `navigationTimeout` | 30s | `playwright.config.js` |
| `actionTimeout` | 20s | `playwright.config.js` |
| `expect` timeout | 15s | `playwright.config.js` |
| `DEFAULT_TIMEOUT` (nav helper) | 20s | `jqm-helpers.js`, `E2E_NAV_TIMEOUT` |
| `waitForJqmPopup` / `...Closed` | 15s | `jqm-helpers.js` |
| `waitForJqmLoader` | 15s | `jqm-helpers.js` |
| field `waitFor` in `fillInActivePopup` | 10s | `jqm-helpers.js` |
| `readLogPage` | 40s | `lifecycle.js` |
| `openApproval` / `freshApproval` | 60s | `approvals.js` |

"It timed out at 20s" was never one thing. The same underlying defect produced 10s, 15s and
20s failures depending on which step it landed on.

## 8. Recommendations

1. **Do not raise timeouts.** Measured: it does not help, because nothing is slow.
2. **Keep the popup scoping fix**, but do not count it as closing the issue — see §5.
3. **Keep `retries: 1` as a net, not a cure.** A retried pass is reported as *flaky*, so it
   stays visible and countable — unlike the navigation fallback tiers that were removed
   from this suite precisely because they made failures look like passes. Two tests
   currently rely on it: `xp-history` 75 and `lifecycle-werewolf` 355b.
4. **Chase the duplicate popups** (§5a) before anything else. They are the precondition for
   this whole class of failure, and removing them would likely take the class with it.
5. **Give 355b its own diagnosis** with the slow-vs-stuck experiment before touching it.
6. **When a test looks slow, trace it before believing it.** Every time this project has
   asked "why is this slow?", the answer has been "it isn't — it is stuck". The trace
   answers that in one step and costs nothing.
7. **Do not accept a single-file pass as proof of a fix.** It was not, twice today: once for
   355b and once for the popup scoping fix above. Only a full-suite run under load counts.

## 9. Verification status, stated exactly

| Claim | Evidence | Status |
|---|---|---|
| Nothing in the app takes ~20s | Trace: 26 actions in 1.8s, max 1.02s | **Established** |
| Timeouts are give-up thresholds, not durations | 15s→90s experiment; no wait exceeded 2s | **Established** |
| The two helpers disagreed on "the open popup" | Read of `waitForJqmPopup` vs `activePopup` | **Established, fixed** |
| That disagreement was the cause of the flake | Full-suite run after the fix: still flaky | **Disproven** |
| The popup opens then closes again | Forced the late render deterministically; popup survived | **Disproven (§5b)** |
| Duplicate popups confuse the locator | Leak fixed, copies bounded 1–2; flake persists | **Disproven (§5b)** |
| `CharacterExperienceView` leaks popups | 7 copies after 3 edits; now bounded at 1–2 | **Established, fixed (§5c)** |
| The leak fix cures the flake | Full run after it: still failing | **Disproven** |
| 355b is fixed | Passed in isolation; failed three times under load | **Disproven — on watch** |
| The popup open is dropped by jQuery Mobile | Not yet tested — diagnostic added to find out | **Open hypothesis (§5d)** |
