# Running the Playwright suite against React

The 24,386-line Playwright suite is the parity gate. `compare:dom` proves two
screens look the same; only the suite proves they *behave* the same.

It runs against both front ends now, unforked:

```bash
node e2e/run-react.js                      # build, then the whole suite
node e2e/run-react.js e2e/troupes.spec.js  # arguments pass through
npx playwright test                        # the legacy app, as before
```

`E2E_FRONTEND=react` is the whole mechanism. It points the per-worker server's
document root at `dist-react/` instead of `public/`, with `public/` mounted
behind it (`PUBLIC_FALLBACK` in index.js) for the assets the React build
references as bare runtime strings rather than imports -- `head_skull.png` is
the one every listing falls back to.

## The two front ends get separate ports

`E2E_FRONTEND=react` adds 50 to `E2E_BASE_PORT`, and this is not cosmetic.
Playwright reuses a server already listening on the port it wants, and the two
apps differ only in that server's document root -- so alternating between a
legacy run and a React run on one port silently tests whichever app happened to
still be up. That is not a hypothetical: a "legacy regression check" during this
migration was really a second React run, 26 green tests against the wrong app.

`global-setup.js` fetches `index.html` from every backend and refuses to start
if the app serving it is not the one asked for. Separate ports make the mistake
unlikely; the assertion makes it impossible to believe.

## How a helper tells the two apart

It asks the page. `window.__yorick` exists on one and `window.require` on the
other, so no spec takes a flag and no helper takes a parameter.

`web/src/shell/testBridge.ts` is what the React side answers with. It is
deliberately small, and everything in it is there because a helper needs it:

| | why |
| --- | --- |
| `redispatch()` | `navigateToHash` to the hash you are already on. The legacy drives `Backbone.history.loadUrl`; React renders from the hash, so "go there again" means discard and refetch. |
| `hardReset()` | `hardReload` without the page load. Drops the query cache, so a React run is not accidentally easier than a legacy one. |
| `busy()` | Whether anything is in flight. See below. |
| `tcrnv` | The relationship network's graph. It is the one screen with nothing in the DOM to assert against -- vis.js draws into a canvas -- and the legacy suite reads the same three fields off the router's memoised view of the same name. |
| `require()` | The module names `runInApp` asks for. See below. |

## The spinner cannot be used as a signal, on either app

`waitForJqmLoader` polls whether `.ui-loader` is hidden, and part of that test is
`loader.offsetParent === null`. jQuery Mobile's stylesheet gives `.ui-loader`
`position: fixed`, and a fixed-position element has no `offsetParent` -- so that
check reports "hidden" whether the spinner is up or not, and always has.

The legacy app survives it because its route handlers finish rendering before
the promise chain resolves, so the next `page.evaluate` naturally lands after
the work. React saves and re-renders asynchronously, and the same helper cheerfully
returned while the row under edit still held its old value. So on React the
helper asks `window.__yorick.busy()` instead: any tracked work, any query in
flight. The legacy path is unchanged, deliberately -- several admin routes leave
the spinner up forever and the generous check is what keeps that known UI bug
from failing unrelated tests.

Separately, and found the same way: the React app was rendering the loader
element without adding `ui-loading` to `<html>`, which is the class the
stylesheet actually keys the spinner off. The spinner never appeared at all.

## `runInApp` reaches the models on either side

The suite does its fixture setup and its assertion read-back through the app's
own models rather than through the UI -- `createCharacter`, `readTraits`,
`readAffinities` and a dozen others in `e2e/helpers/`. On the legacy front end
that is `window.require(['app/models/Vampire'], ...)`.

`web/src/shell/e2eModelApi.ts` answers the same module names with the same
*legacy* method names, over the ported modules. Keeping the old names is
deliberate: the alternative is editing the suite that is being used to prove the
port correct, and a shim with a dozen methods in it is a much smaller object to
be wrong about than 24,000 lines of spec.

The `runInApp` bodies lost their lodash along the way. They ran on a global the
React app has no reason to carry, and `_.map(x, f)` was never worth a
dependency.

## What the suite has found so far

Everything here is a defect `compare:dom` could not see, because both apps
render correct markup and only the data behind it differed:

- The query cache served the previous visit's answer: unpick a creation slot and
  the wizard still showed it spent; choose a clan and the discipline picker
  still offered the whole catalogue.
- Sum pools counted every merit as free, because a pick is a pointer and an
  unfetched pointer has no `value`. Parse 1.5's single-instance cache had made
  the pointer and the loaded trait the same object.
- The trait editor fetched the character and the trait as two queries, so a
  background refetch left them belonging to different fetches and every save
  failed the identity check inside `updateTrait`.
- The Changeling Kith mechanic -- affinity Arts granted free, the Art creation
  pool spent, both reconciled on a repick -- had not been ported at all.
- `character_join_troupe` rendered the troupe without joining it.
- The character sheet read `id` where `troupe/:id/character/:cid` puts the
  troupe, so that route could never open a sheet at all.
- The extended print text never reached a printed sheet: it was read as a
  character attribute, and long texts are rows of their own class.
- Non-admins could open every one of the eighteen admin routes.
- Four save paths showed the loading overlay and never hid it, which leaves it
  up forever and swallows every subsequent click.
- `data-icon` was missing from list rows. jQuery Mobile leaves it in place and
  the suite selects on it; attributes are exactly what `compare:dom` ignores.

The spinner leak is also the reason a React run was *slow*: with the overlay
stuck, every "wait for the app to settle" burned its full timeout. Fixing it
took `xp-history.spec.js` from 9.3 minutes to 13.8 seconds -- faster than the
same file against the legacy app, which takes 36.

## Where the suite stands

Every spec file is green on both front ends, with no unexpected failures.

## Two differences the suite had to be told about

Neither is behaviour; both are jQuery Mobile's model showing through an
assertion.

**Which page is left behind by a refused route.** jQM keeps every visited page
in the document and simply does not transition when a handler fails, so the
legacy app is still showing the page you came from. React has no page to
withhold -- the hash decides what is shown. Three access-control assertions
proved a refusal by naming the previous page; they now count what rendered
inside the region that should have been filled, which is zero on both and is
the thing actually under test.

**Text length.** Every element in the legacy templates sits on its own line, so
the text carries the indentation between them; JSX drops whitespace between
siblings. Measured directly against the same character and the same backend, the
printable sheet is character-for-character identical once whitespace is
stripped, and the legacy is about ten percent longer. Three `sheet.length > N`
thresholds were therefore measuring indentation, and now measure content.

Where the whitespace is *readable* rather than incidental it was restored
instead: "Available 30" in the experience table and "Morality Humanity" on the
printed sheet both come from a newline in the template, and both are asserted by
name.

## The full run, both stacks

Measured on a quiet machine at two workers, with the config's own reporters
(passing `--reporter=list` on the command line REPLACES the reporter array, so
no `runs/*.json` is written and `test:diff` has nothing to compare):

```
npm run test:diff -- runs/legacy.json runs/react.json

    0  NEW-FAIL   regressions
    0  new-pass   fixed, or baseline was flaky
  449  same-pass
    0  same-fail
    0  added
    0  removed
    2  skipped
    1  flaky
```

Legacy takes 13.9 minutes, React 6.3.

An earlier four-worker run reported one test at 1.1 hours -- impossible against
a 120-second per-test timeout, and the tell that the machine, not the app, was
the problem: a dev server, a Vite server and two stale E2E backends were still
running alongside four workers. Cleaned up and re-run, the same five specs were
124/124. Treat any run with implausible per-test times as unmeasured.

## One open flake, React only

`troupes.spec.js` 140 -- "A stranger user not in the troupe cannot open the
troupe roster" -- has failed on the first attempt of all three full React runs
and of no legacy run. It always passes on the retry, and it has never been
reproduced in isolation: 3/3 at one worker, and 3/3 more at two workers with the
whole file repeated.

What is established, and it rules out the easy explanations:

- The login completes. The trace shows `loginAs` filling the form as
  sampstranger and its `Parse.User.current().get('username') === 'sampstranger'`
  wait resolving before the navigation.
- The failure is not a race against rendering. `toHaveCount(0)` retries for
  fifteen seconds and the log reads `33 x locator resolved to 1 element` -- the
  storyteller-only link is present for that whole window.
- The captured page snapshot says "Log Out devuser", which looks damning and is
  not: the trace shows it was taken during the `afterAll` hook, which logs in as
  devuser to clean up. The snapshot is later than the failure.
- No `_User` write appears anywhere in the trace, so the start page's
  storyteller recompute never changed the flag.
- Instrumented at the point of the assertion, under the same two-worker load,
  the answer is always `{username: sampstranger, st: false, ad: false, links: 0}`
  -- which is the passing case, six times out of six.

So the input to the decision (`session.storyteller || session.admin`) is right
whenever it can be observed, and the cause of the failing case is not known.
Both the "stale React session" and the "wrong user" theories are dead. It stays
recorded rather than explained, and Playwright reports it as flaky rather than
passing, so it cannot quietly disappear.

## Still to do

- `popup-trace.js` hooks `app/views/CharacterExperienceView` through
  `window.require` to watch popups from inside the view. There is nothing to
  hook in React. It is diagnostic-only and already guarded, so it degrades to a
  no-op rather than failing; rewriting it against the DOM is worth doing only if
  a popup timing problem actually appears on the React side.
- Finding out what troupes 140 is actually doing.
