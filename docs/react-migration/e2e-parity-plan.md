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
- `data-icon` was missing from list rows. jQuery Mobile leaves it in place and
  the suite selects on it; attributes are exactly what `compare:dom` ignores.

## Still to do

- `popup-trace.js` hooks `app/views/CharacterExperienceView` through
  `window.require` to watch popups from inside the view. There is nothing to
  hook in React. It is diagnostic-only and already guarded, so it degrades to a
  no-op rather than failing; rewriting it against the DOM is worth doing only if
  a popup timing problem actually appears on the React side.
- A full clean run of both stacks, compared with `npm run test:diff`.
