# Migrating Yorick's front end to React

The React app lives in `web/` and is built with Vite and TypeScript. It talks to
the same Parse server as the existing app, and it is meant to be
indistinguishable from it: same screens, same URLs, same markup, same
stylesheet.

Until it reaches parity, both front ends exist side by side and neither
disturbs the other. `dist/` still holds the committed build of the legacy app,
which is what Netlify deploy previews serve; the React app builds to
`dist-react/`.

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
lists what remains, grouped by the page it renders.

Beyond those, the real safety net is the existing Playwright suite: 24,386 lines
across 21 spec files. Its jQuery Mobile coupling is concentrated in
`e2e/helpers/jqm-helpers.js` and `e2e/helpers/popup-trace.js` rather than spread
through the specs, and the React screens keep the page ids and `ui-page-active`
that those helpers wait on. Pointing the suite at the React app is the parity
gate, and it has not been done yet.

## Adding a screen

1. Read the legacy view and its template. `npm run migration:status` names the
   handler; `web/src/router/screenMap.ts` names the page id and the arguments.
2. Write the component in `web/src/screens/`, rendering a `<Page>` with that
   page id. Keep every id and class the E2E suite selects on.
3. Register it in `web/src/screens/index.ts` under the legacy handler name.
4. `npm run compare:dom -- "#the/url"` until it matches.

The generated files -- `routeTable.ts`, `screenMap.ts`, `pageTitles.ts` -- are
extracted from the legacy source by `npm run generate:routes`. Re-run it after
any change to `mobileRouter.js` or `index.html`; do not edit them by hand.

## Bugs found while porting

None of these are fixed here. All are in the legacy app today, and changing
behaviour during a port is how a migration stops being reviewable -- every diff
would then have two possible explanations.

The exception is noted below: one of them cannot be reproduced without writing
code whose purpose is to render nothing.

**The start page's troupe shortcuts have been empty since the Parse 8 upgrade.**
`PlayerOptionsView.js:71` reads a role's name through a doubled property path:

```js
var id = role.attributes.attributes.name;
```

Under Parse 1.5 that resolved. Under parse@8 `role.attributes` is the plain
attribute bag, so `.attributes` on it is undefined, `id` is undefined, no troupe
is ever matched, and "Troupe View All Characters" renders as a heading above an
empty list -- for every user, including storytellers who staff a troupe.
Measured against the running app with an account holding `LST_<troupeId>`: both
the role and the troupe are in cache, and the lookup succeeds through
`role.get("name")` and fails through the path above.

This is the one place the React app deliberately diverges. The legacy fix is one
word.

**A dead Facebook button still paints on the profile page.**
`FacebookLinkButtonView` renders "Link Account to Facebook", whose click handler
calls `Parse.FacebookUtils.link()` -- but `app/loadall.js` deliberately no
longer calls `Parse.FacebookUtils.init()`, because under parse@8 it throws
during bootstrap and takes the router down with it. The button cannot work. Not
ported; the region div is kept and its contents are not.

**`sortbycreated` has never worked.** Five call sites in `mobileRouter.js` set
it on a local array, while the collection comparators in `Vampires.js`,
`Patronages.js` and `Users.js` read it off the collection. `reset()` copies the
array's elements, not its properties, so the branch is dead and every listing
has always sorted by name. Confirmed against the running app with `devuser`, the
one account it is supposed to apply to.

**A player's own roster never shows the owner line.**
`character-list-item.html` prints the owner when `owner.get("username")` is
truthy, but `get_user_characters` does not `include("owner")`, so the pointer is
a stub and the line is skipped. It renders in the admin and troupe listings,
which hydrate owners through `UserWreqr`. The React app reproduces this, and
would have diverged silently if single-instance mode had been left on.

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
