# Pointing the Playwright suite at React

The 24,386-line Playwright suite is the parity gate. `compare:dom` proves two
screens look the same; only the suite proves they *behave* the same. This is
what it will take to run it against the React app, measured rather than
estimated.

Nothing here is done yet. It is written down now because the answer turned out
to be much smaller than the suite's size suggests, and that should shape how the
remaining screens are ported.

## What the suite actually depends on

Counted across `e2e/`:

| Global | Uses | Available in React? |
| --- | ---: | --- |
| `window.Parse.*` | 213 | **Yes.** `web/src/parse/init.ts` assigns `window.Parse` deliberately, for this. |
| `window.jQuery*` | 18 | No. |
| `window.require` | 8 | No -- there is no AMD loader. |

So 213 of 239 references already work. The suite talks to the *database*
far more than it talks to the *framework*, which is why it survives a rewrite of
the framework.

The DOM contracts survive too, by construction: the React screens keep their
page ids, `.ui-page-active` marks the visible page, `.ui-loader` is the spinner,
and `.ui-popup` / `.ui-popup-screen` are the popup. Those were kept because the
suite selects on them.

## The 26 references that need work

They sit in four helper files and two specs.

**`e2e/helpers/jqm-helpers.js`** -- 8 sites. The heart of it is
`waitForAppReady`, which requires jQuery, jQuery Mobile, Parse and RequireJS all
to be present. It needs a branch: the React app is ready when the Parse SDK
answers without throwing. `web/scripts/compare-dom.mjs` already contains a
working version of exactly this check (`ready()`), including why
`Parse.applicationId` alone is not enough -- reuse it.

`waitForJqmLoader` needs no change: React renders the same `.ui-loader`.
`waitForActivePage` needs no change: React renders the same `.ui-page-active`
with the same ids.

**`e2e/helpers/popup-trace.js`** -- 6 sites, and the awkward ones. It reaches
into `app/views/CharacterExperienceView` through `window.require` to hook the
view and watch popups from the inside. There is no equivalent to hook in React,
so this needs rewriting against the DOM instead of against the view. Do this
when the experience screen is ported, not before -- the right shape will be
obvious then and guesswork now would be wasted.

**`e2e/helpers/auth.js`** -- 2 sites, both in the "transition to the login page"
step, which calls `$.mobile.changePage`. In React, setting `location.hash` is
enough; the guard in `App.tsx` shows the login screen without touching the hash,
exactly as `enforce_logged_in` does.

**`e2e/helpers/save-trace.js`** -- 1 site.

**`e2e/creation-changeling.spec.js:1527`** -- loads
`app/models/ChangelingBetaSlice` through `window.require` to construct a model
in the page. Already written defensively (`window.require ? ... : ...`), so it
has a fallback path; check that the fallback is adequate rather than adding a
module loader.

**`e2e/admin-patronage.spec.js:85`** -- 1 site.

## The approach

Do not fork the suite. A second copy of 24k lines would drift from the first
within a week, and the whole value of the suite is that it describes one system.

Instead: make the helpers front-end-aware. They already centralise the coupling,
which is why this is possible at all. A helper that needs to behave differently
should detect which app it is talking to -- `window.jQuery` is present on one
and absent on the other -- rather than take a flag, so a spec never has to know.

Run the suite against React with `E2E_BASE_PORT` set to this worktree's block
(1500) so a run cannot collide with another worktree's; see
`.claude/dev-react.js` for the registry and `e2e/ports.js` for how workers
allocate from the base.

## Sequencing

The suite cannot pass until the screens it exercises exist, so this is not a
task to start now. But two things should happen as porting continues:

1. **Every ported screen keeps its selectors.** This is already in the porting
   guide. It is the reason the number above is 26 and not 2,600.
2. **`popup-trace.js` is rewritten when the experience screen lands**, by
   whoever ports it, because they will be holding the context needed to do it.

The first full run should be attempted once the character sheet, trait and XP
screens are ported -- those are what most specs drive. Expect the first run to
fail broadly on timing rather than on behaviour: the legacy app's async chains
settle differently from React's, and several helpers sleep on jQuery Mobile page
transitions that no longer happen.
