# Migrating Yorick's front end to React

The React app lives in `web/` and is built with Vite and TypeScript. It talks to
the same Parse server as the existing app, and it is meant to be
indistinguishable from it: same screens, same URLs, same markup, same
stylesheet.

All 75 of the legacy router's handlers are ported. 55 of 59 checked screens
match the legacy DOM exactly -- the other four differ for reasons written down
below and in the screens themselves -- and the Playwright suite reports 449
same-pass with no regressions against the legacy app (`e2e-parity-plan.md`).

The port is done. **The flip is not, and it is not mine to make** -- see below.

Both front ends exist side by side and neither disturbs the other. The React app
builds to `dist-react/`, which is self-contained; `dist/` still holds the
committed build of the legacy app.

## The flip is an owner decision, not a config change

The plan was "build alongside, flip at the end", and the flip reads like one
line: point `build.outDir` at `../dist` instead of `../dist-react`. It is not,
because of what `dist/` actually is.

`dist/` is not a preview artefact. It is the **production** build: `gulpfile.js`
has a `siteconfig-greensboro` task that writes the production site config into
it, and greensboro is production. `docs/runbooks/dependency-vulnerabilities.md`
§2 says so explicitly, and records a decision already taken about it: `dist/` is
deliberately stale, a *pre-Parse-8* build, left as it was because rebuilding it
would ship the Parse 8 migration that production has not taken. Several
browser-side security fixes are waiting behind that same decision.

So overwriting `dist/` with the React build would do three things at once, only
one of which is this migration: publish the rewrite, publish the Parse 8
migration with it, and reverse a documented decision about when production takes
that change. That is a deploy, and it wants an owner.

What is ready for whoever makes it:

- `dist-react/` is a complete, self-contained build. `npm run build:react`.
- The suite runs against it unmodified -- `node e2e/run-react.js`.
- The switch itself is `build.outDir` in `web/vite.config.ts`, plus deleting the
  gulp build's output from `dist/`, which `emptyOutDir` does.

## Running both

This worktree owns its own ports so it cannot collide with another worktree's
dev server; the registry is at the top of `.claude/dev-react.js`.

```bash
node .claude/dev-react.js
```

That starts the legacy app and the Parse API on <http://localhost:41500>, with
its own MongoDB on 27117+200 and its own database. Then, separately:

```bash
npm run dev:react
```

The React app comes up on <http://localhost:41501> and proxies `/parse` to
41500, so both front ends read and write the same records and can be compared
screen by screen.

A fresh database is empty. Seed it:

```bash
npm run seed
```

## The four decisions

**The look is not being redesigned.** The React app keeps
`jquery.mobile-1.4.5.min.css` and renders the DOM that jQuery Mobile's
JavaScript would have produced, so the stylesheet applies unchanged.
`web/src/jqm/` holds a component per widget, each emitting markup captured from
the running legacy app rather than transcribed from documentation --
`docs/react-migration/jqm-enhanced-markup.md` has the captures, and
`harvest-jqm-markup.js` re-takes them.

There is a second widget vocabulary underneath: 21 view files build their forms
with Backform, whose output is Bootstrap horizontal-form markup that jQuery
Mobile then enhances on top of. `web/src/forms/Backform.tsx` reproduces those
seven controls.

**URLs do not change.** The legacy route table cannot be expressed in an
off-the-shelf React router -- patterns like `characters?:type` put a literal
question mark mid-pattern, which every other router reads as the start of a
query string. So `web/src/router/backboneRoutes.ts` is Backbone 1.1.2's own
route compiler, ported. `npm run verify:routes` proves it: it lifts
`_routeToRegExp` out of the vendored `backbone.js` at runtime and compares the
compiled regex for all 81 patterns, plus extracted parameters on the awkward
fragments.

**The Parse compatibility layer does not come across.** The legacy app reaches
the SDK through `public/scripts/lib/parse-compat/`, ~250 lines restoring Parse
1.5's API -- `Parse.Promise`, Backbone change events on `Parse.Object`,
`Parse.Collection`, `Parse.Router`. All of it serves Backbone and Marionette.
React imports `parse` directly: promises are native, change notification is
React state, collections are arrays, the router is `web/src/router/`.

One piece of that layer *is* kept, and deliberately:
`Parse.Object.disableSingleInstance()`. See the comment in
`web/src/parse/init.ts` for which of the original's two reasons still applies.

**Three creature types, one table.** Vampire, Werewolf and ChangelingBetaSlice
all register the Parse className `Vampire` because they share one Mongo table.
The legacy app achieves per-venue behaviour with `helpers/VenueClass.js`, which
hands each module a private constructor and prototype over the one shared
registered class. React has one `Character` class and selects venue behaviour
from the row's `type` attribute -- the same thing every template already
switches on. Do not split the table.

## Proving the port

Two commands, both run against the live pair of servers.

```bash
npm run compare:dom -- "#characters?all"
```

Loads a screen in both front ends, reduces each to a tree of tags, ids and
classes, and diffs them. Text, inline styles and attribute order are ignored;
what is left is what the stylesheet keys off, so a match means the two screens
look the same. With no arguments it checks the screens ported so far.

```bash
npm run migration:status
```

Counts registered screens against the legacy router's 75 routed handlers and
lists what remains, grouped by the page it renders. It also checks every legacy
view file for a React screen that names it, which is a different question from
the handler count and catches what the handler count cannot: `simpletraits`
dispatches to two views on one route, so it read as ported while 368 lines of
`SimpleTraitNewView.js` had no counterpart at all.

Beyond those, the real safety net is the existing Playwright suite: 24,386 lines
across 21 spec files. Its jQuery Mobile coupling is concentrated in
`e2e/helpers/jqm-helpers.js` and `e2e/helpers/popup-trace.js` rather than spread
through the specs, and the React screens keep the page ids and `ui-page-active`
that those helpers wait on. Pointing the suite at the React app is the parity
gate, and it is what remains -- see `e2e-parity-plan.md`.

## Adding a screen

1. Read the legacy view and its template. `npm run migration:status` names the
   handler; `web/src/router/screenMap.ts` names the page id and the arguments.
2. Write the component in `web/src/screens/`, rendering a `<Page>` with that
   page id. Keep every id and class the E2E suite selects on.
3. End the file with `registerScreen('<handler>', Component)`. `index.ts` globs
   the directory, so there is no shared list to edit and no conflict with
   whoever is writing the screen next to yours.
4. `npm run compare:dom -- "#the/url"` until it matches.

The generated files -- `routeTable.ts`, `screenMap.ts`, `pageTitles.ts` -- are
extracted from the legacy source by `npm run generate:routes`. Re-run it after
any change to `mobileRouter.js` or `index.html`; do not edit them by hand.

## Bugs found while porting

Eighteen, catalogued in `docs/legacy-bugs-found-during-react-port.md`. Entries
#0-#17 are **fixed on main** -- see `docs/legacy-bugs-fixed.md` -- and the port
has followed each of them across, so the two front ends agree again. Only #18 is
still open, and it is seven lists rather than one: a sweep after #16's fix found
that `CharactersListView` is the only view in the app that re-enhances a listview
after writing rows into it. The five patronage lists and the two filterable
rosters do not. `web/src/screens/Profile.tsx` carries the one remaining
`@compare-known` marker, for the only one of the seven the comparison harness
can see.

The port used to diverge deliberately in two places -- the start page's troupe
shortcuts, which the legacy rendered empty, and the profile page's dead Facebook
button. Both are gone: the legacy renders the shortcuts now, and the Facebook
section was removed rather than repaired.

## Two things about jQuery Mobile worth knowing

**Writing `class="ui-btn"` into source markup is an instruction, not a
shortcut.** `$.fn.buttonMarkup` runs `classNameToOptions()` over the existing
class list and treats an element already carrying `ui-btn` as one it enhanced
before -- so the *absent* `ui-shadow` and `ui-corner-all` are read back as
`shadow: false, corners: false`. `templates/troupe.html` does this on five
buttons, which are square and flat as a result.

**jQuery Mobile does not enhance `<button>` through its button widget at all.**
That widget's initSelector is `input[type='button'], input[type='submit'],
input[type='reset']` (jquery.mobile-1.4.5.js:8202). Real `<button>` elements are
reached only by `$.fn.buttonMarkup` during page enhancement.
