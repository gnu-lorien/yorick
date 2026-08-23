# Vue migration

**Status:** IN PROGRESS
**Branch:** `claude/migrate-project-vue-cb0512`
**Started:** 2026-08-21

## What this reverses

`yorick-modernization-differential-cutover.md:686` lists **"Front-end
re-platform — Ruled out during office hours. Backbone/Marionette/RequireJS
stay"** in its NOT-in-scope table, and its first constraint at `:75` is "Same
app. Identical UI and behavior." That document is APPROVED and every runbook
since executes against it.

This branch reverses that decision at the owner's explicit direction. It is
recorded here so nobody later reads the two documents and assumes one of them
was written in ignorance of the other.

It also does not supersede that design's other work. MongoDB 5.0 is EOL and must
move regardless; production's class-level permissions still need repairing;
`going-live.md` step 0 has still never been run against the merged tree. A Vue
front end neither helps nor delays any of that, and must not consume its
schedule.

## Prior art

`origin/feature/vue3-migration` is a 198-commit Vue 3 + Vite + Pinia +
TypeScript attempt from Aug 2021 to Mar 2023, covering ~13 of 50 screens. Its
final commit is titled *"Stuck with reactivity not causing the print components
to be redrawn."*

It is **not resumable**. It forked from `greensboro` in Aug 2021, before the
Parse 8 migration, the S11 private-users refactor, the security remediation and
the E2E suite. Its value is knowing exactly where it stopped, which shaped the
first decision below.

## Decisions

### 1. Parse objects get an explicit reactivity signal

This is the one that ended the previous attempt.

A `Parse.Object` cannot go in `ref()` — it is a live SDK object with private
state and a shared pointer graph, and deep-proxying hands the SDK proxies where
it expects its own instances. So stores hold `shallowRef`s, and then
`character.set("name", x)` mutates *inside* the object and nothing re-renders.

`client/src/parse/reactivity.ts` wraps every mutating method on
`Parse.Object.prototype` once at startup and bumps two counters: one per object,
one global. `track(obj)` subscribes a computed to one record; `trackAll()`
subscribes it to every Parse mutation anywhere. The printable sheet reads a
character, its traits, its long texts and its creation record — a graph, where a
per-object subscription misses a trait edit two pointers away. That graph read
is precisely the case the previous attempt got stuck on, so coarse invalidation
is the default and precise invalidation the opt-in.

### 2. Keep jQuery Mobile's stylesheet, drop its JavaScript

jQuery Mobile 1.4.5's CSS is class-driven: `ui-btn`, `ui-listview`, `ui-grid-c`
style whatever markup carries them. Its script existed to *generate* that markup
by enhancing plainer HTML at runtime — 110 `$el.enhanceWithin()` calls across 42
view files. Vue components emit the enhanced markup directly.

This buys three things at once: the app looks identical, `printable_sheet.css`
(86 lines written entirely against jQM class names) keeps working, and the
DOM the E2E suite asserts on is preserved.

**The markup was measured, not remembered.** Raw markup was injected into the
running legacy app, `enhanceWithin()` was called, and the result serialised.
That caught three bugs in a first draft written from documentation: jQM *wraps*
text inputs in a styled div rather than classing them, checkboxes carry no
`ui-icon-checkbox-*` class, and the slider handle has no `ui-corner-all` and no
fill element. Ground truth is in `client/src/components/jqm/REFERENCE.md`, and
`jqm-markup.spec.ts` pins it so a later edit cannot silently change how every
screen looks.

Two pieces of jQM's JavaScript had to be replaced rather than dropped:

- `ui-mobile` on `<html>` and `ui-mobile-viewport ui-overlay-a` on `<body>`.
  `.ui-mobile .ui-page-active { display: block }` is gated on the first, so
  without it *every page renders `display: none`* and the screen is blank.
  Set statically in `client/index.html`.
- The positional classes `ui-first-child` / `ui-last-child`, which jQM applied
  by walking children after every render — the reason `.listview("refresh")`
  had to be called by hand. `client/src/styles/jqm-structural.css` restates
  those rules against `:first-child` / `:last-child`, so a reactive list is
  always correct with no refresh call anywhere.

### 3. Hash URLs are preserved byte-for-byte

Vue Router's `createWebHashHistory` cannot express this app's URLs. It always
writes a leading slash (`#/characters`), and Backbone treats `?` as an ordinary
path character — `"characters?:type"` means the literal text `characters?`
followed by a parameter, so `#character?abc123` is a path, not a query string.
Vue Router splits on `?` while parsing, before matching.

`client/src/router/backbone-hash.ts` compiles Backbone's own patterns and
translates both ways over a memory history. The address bar shows exactly what
Backbone showed.

That is not cosmetic. The URLs are in players' bookmarks; `navigateToHash` drives
all 256 of its E2E call sites by them; and 17 further waits use **hash assignment
as the completion signal for a mutating save**, because the app has no DOM signal
for a finished write.

The route table (`client/src/router/routes.ts`) is *generated* from
`mobileRouter.js:198-303` and kept in its declaration order — Backbone matched in
order, so `troupe/new` must still be tried before `troupe/:id` — which lets the
81 routes be diffed against the original rather than trusted as transcription.

### 4. Three creature types, one Parse class, venue strategies

Vampire, Werewolf and ChangelingBetaSlice all register className `"Vampire"`
because they share one Mongo table. Never split them; that is a data migration
on live player records.

Parse 1.5 turned a repeated className into an inheritance chain. parse@8 has one
class per className and merges every registration into one prototype, so the
last module loaded wins for every venue — measured, in the legacy app, as
choosing "Vampire" and getting a row with `type: "ChangelingBetaSlice"`. The
Backbone app works around this with `helpers/VenueClass.js` plus a
`__compatCast` hook patched into `Parse.Query`.

Here: one registered `CharacterObject`, and venue behaviour in strategy objects
selected on `venueOf(character.get('type'))`. Nothing to cast, no load-order
dependence, and both workaround files retire.

**`type` absent means Vampire.** Old records predate the column. `venueOf` is the
only place that decision is made, and it is why the venues are not a TypeScript
discriminated union — a union will not tolerate a nullable discriminant.

### 5. `undefined` is not zero

The cost engines return `0` only for categories on an explicit `FREE_CATEGORIES`
allowlist and `undefined` when no rule exists; `Character.update_trait` turns
that `undefined` into a visible refusal. Two whole categories (`wta_rites`,
`ctdbs_backgrounds`) were silently free for an unknown period before this
protocol existed.

An idiomatic TypeScript port erases exactly this: `strict` produces
`number | undefined` at every boundary and the shortest way to satisfy the
compiler is `?? 0`. So `noUncheckedIndexedAccess` is **on** — it is the one
setting that flags the table lookups — every cost function returns
`number | undefined`, and the unit tests assert that an unknown category returns
`undefined` and not `0`.

### 6. No `parse-compat`

`public/scripts/lib/parse-compat/` exists to make parse@8 look like Parse 1.5 to
Backbone: `Parse.Collection`, `Parse.Router`, `Parse.Promise`, model change
events, `cid`, `_byCid`, `_serverData`, `_previousAttributes`. Vue Router
replaces the router, reactive stores the collections, native promises
`Parse.Promise`, and Vue reactivity the change events. The shim does not ship in
the Vue client.

What that costs, and how each is paid, is recorded at the call sites:
`Parse.Promise.when` resolved with *separate arguments* and rejected with an
*array* (24 call sites); `.always()` was a **mutex**, not cleanup — eight
per-instance chains in `Character` rely on a rejection becoming a fulfillment so
the queue never wedges, and `.finally()` re-throws; and `cid` was the
client-side identity of an unsaved trait.

## Testing

### Both apps, one suite

`public/` is untouched. `index.js` serves whatever `PUBLIC_BASE` points at, so
one variable switches the entire E2E suite between the legacy client and the Vue
build:

```bash
npm run test:e2e                      # legacy, from public/
YORICK_E2E_CLIENT=vue npm run test:e2e   # Vue, from client/dist
```

The helpers detect which app answered *by capability*
(`e2e/helpers/jqm-helpers.js#detectApp`), so no spec file and no environment
variable needs to know. Three functions branch — bootstrapping, the slider, and
`runInApp`'s module loading. Everything else was already written against the DOM
and works unchanged.

Most of the helper layer turns out to be **jQuery Mobile bug workarounds** that
Vue does not need: duplicate popup copies left behind by re-renders, the
`ui-loading` class stranded by routes that never call `.hide()`, and Backform
controls that copy their DOM value into the model only on `change`. They stay
callable so the spec files need no edit.

`window.__yorickApi` (`client/src/testing/app-api.ts`) is a deliberate test
surface: `reload(hash)` re-dispatches the current route — the job
`Backbone.history.loadUrl` did — and `modules` publishes the ported domain under
the **same AMD paths** the specs already name, so all 18 `runInApp` call sites
are unchanged. The alternative was rewriting fixture setup for 451 tests, which
would make the migration's only oracle newly written and unverified.

### The baseline

`going-live.md:29-38` says step 0 — running the gate — has never been done, and
calls it "the single biggest gap in what has been handed to you." So there was
nothing to compare a Vue run against.

There is now: `runs/vue-migration-baseline-legacy.json`, recorded against the
current Backbone app on this branch — **467 passed, 0 regressions**. That is
useful whether or not this migration continues.

Re-record it after adding or removing a spec. The gate refuses to return a
verdict when the candidate's test count drifts more than ±9 from the baseline's
("the suite that ran is not the suite the baseline recorded"), which is the
check working: coverage numbers from a different corpus are not a comparison.

```bash
E2E_BASE_PORT=2337 node gate.js --name <run> --baseline runs/vue-migration-baseline-legacy.json
```

### Where it landed

**PASS — all 467 tests that pass on the Backbone front end pass on the Vue one**,
with 0 flaky in a clean run, plus 227 unit tests in `client/src/**/*.spec.ts`.
Every route in `mobileRouter.js` is ported; no `TODO(port)` remains.

The gate is what found nearly every defect below, and the ones it did not find
came from running the SAME probe against both front ends and diffing the output.
That technique is worth naming: reasoning from the source told me what the code
was supposed to do, and comparing live output told me what it actually did. The
printed sheet reading `Blood / 0` instead of `Blood 10 / 1`, and the missing
per-sheet print settings form, were both invisible to the first method.

A sample of what a faithful port turned out to require, kept because each one
looks like a detail and is not:

- **A progress label is not another unit of work.** `ui.beginWork` used as a
  progress callback incremented a counter nothing decremented, so the spinner
  stayed up for the session. Invisible until the spinner had CSS that could show
  it — then it cost 38 passing tests.
- **`waitForJqmLoader` never waited, for either front end.** `.ui-loader` is
  `position: fixed`, a fixed element's `offsetParent` is always null, and the
  helper read that as "cleared". The suite had been racing the app and winning
  on timing.
- **Vue condenses template whitespace; underscore did not.** A heading and the
  value on the next line rendered `MoralityHumanity` instead of
  `Morality Humanity`. That is observable output — twenty-odd assertions read a
  sheet as whitespace-normalised text — so the compiler is set to `preserve`.
- **The history replay undid changes in the wrong order.** Order only matters
  when one trait was edited twice, and then it decides the answer.
- **`get_character` IS the login gate**, one call down from the handlers that
  looked ungated. Thirteen character routes were open to a logged-out visitor.
- **`if (is_ad) { ... }` with no `else` is a third kind of gate**, observably
  different from the one that reports and redirects.

### What 447 passing tests did not tell me

The suite asserts behaviour and text. Nothing in it asserted that a control is
STYLED — and the port shipped a bare browser filter box, a character sheet whose
tiles were blue underlined links, and an unstyled font-size dropdown, with every
test green. A human found all three by looking at the screen.

The cause was not a missing stylesheet, which is the natural first guess and the
one I had to disprove: the `<link>` tags are byte-identical to the Backbone
app's. jQuery Mobile's JAVASCRIPT builds the markup its CSS styles, and I had
reproduced that markup by hand — correctly for buttons and checkboxes, not at
all for listview items, and not for the wrapper `<div>` that a search box's
styling lives on. jQM's 1.4.5 stylesheet contains no `:first-child` selectors
and no rule matching a bare `<select>`, so an unenhanced control is not slightly
off; it is unstyled.

`e2e/jqm-enhancement.spec.js` closes that gap, and it runs against BOTH front
ends: jQM's own JavaScript is the specification, so a failure on the legacy
client means the invariant is wrong rather than the app. It found one genuine
inconsistency in the original on its first run — `EditRules` never calls
`enhanceWithin()`, so the rule editor's category select is unstyled while the
identical control on the Descriptions screen is not — which is recorded in the
spec as a reviewed difference rather than silently skipped.

## Ports

This worktree runs on its own block, because `main` and the React worktree may be
running at the same time and `e2e/ports.js` hands workers fixed ports. See
`.claude/worktree-ports.env`.

| | |
|---|---|
| Vite dev server | 5273 |
| App / parse-server | 42337 |
| Dev MongoDB | 27237 |
| E2E base | 2337 |

## Building

`vite build` writes to `client/dist`. It does **not** write to the tracked
`dist/`, which is the front end Netlify publishes and the only automated check
any pull request on this project gets — it currently holds a 2021 build. An
ordinary dev command must not destroy the last known-good published artifact.
Publishing is explicit: `npm run publish:vue`.

The four gulp targets rewrote one line of `siteconfig.js` with `gulp-replace` to
select a deployment. Vite selects the same table entry from
`VITE_YORICK_TARGET`; see `npm run build:vue:patron` and friends.

## Known risks

- **Netlify.** Nothing in this repository configures it — no `netlify.toml`, no
  `_redirects`, no `.github/`. It reportedly runs Node 10, which cannot read a
  format-3 lockfile, let alone build Vite 7. This is unresolved and is not
  visible from inside the repo.
- **Landing.** ~26,000 lines of front end against a repository with no CI. The
  E2E suite is the review signal; there is no second one — and it is a good one,
  but it is not a complete one. It exercises what it was written to exercise;
  a screen it never opens is a screen nobody has checked.
- **What the suite does not cover.** `#victims?all` renders three words and is
  reachable only by typing the hash. `#category?:type` throws in the Backbone
  app for every input and does nothing here. Neither is tested, because neither
  does anything.
- **Production is `greensboro`**, which shares a January 2020 merge base with
  `main` and pins node 14. A Vue 3 build has no path onto it. The realistic
  failure mode for this work is not a crash — it is completion without
  deployment.
