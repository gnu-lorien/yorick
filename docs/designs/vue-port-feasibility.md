# Porting Yorick to Vue: what one page cost, and what the rest would

Written alongside a working Vue implementation of the character history page,
which is on this branch and reachable at `#character/<id>/vue-history/0`. The
Marionette page is untouched and still lives at `#character/<id>/history/0`, so
the two can be opened against the same character and compared.

The point of the exercise was to answer a sizing question with a measurement
rather than an estimate: what actually happens when you put Vue inside this
app, and what does it cost per page?

## The short answer

The view layer is the easy part. The data layer does not have to move. The
expensive part is jQuery Mobile, and it is expensive in a way that has nothing
to do with Vue.

Per-page, this page came out at **1,183 lines of Vue against 1,590 lines of
Marionette view code plus templates** - about three quarters the size, with the
timeline metadata, keyboard stepping, empty and error states, and a scrolling
change table added rather than dropped. The sheet it renders is character-for-
character identical to the Marionette one, asserted as a test rather than as a
claim (`e2e/character-history-vue.spec.js`).

## What the port actually needed

Three things, none of them large:

1. **A vendored Vue.** `public/scripts/lib/vue.global-3.5.41.js`, the full
   build, loaded through RequireJS with a two-line `shim`. Components declare
   `template:` strings and are compiled in the browser, so **no build step was
   introduced**. This matters more than it sounds: the app has no bundler, and
   the first sentence of most "port to Vue" plans is "first, add Vite", which
   is a change to how the project is built, deployed and debugged before a
   single line of UI has moved.

2. **A reactivity bridge**, `public/scripts/app/vue/bridge.js`, 40 lines of
   actual code. Two rules:
   - A `Parse.Object` must never become reactive. `reactive()` and `ref()` hand
     back a Proxy, and everything in the models that compares object identity
     breaks - `_.xor(traits, [current, fake])` inside `get_transformed` stops
     finding `current`, and the SDK stops recognising its own children when
     saving. Everything crossing into a component goes through `markRaw` or
     sits in a `shallowRef`.
   - Because Vue cannot see inside those objects, `useModelRevision` turns the
     Backbone event a model already fires into a plain incrementing number,
     which *is* reactive. That number is the entire bridge between Backbone's
     change events and Vue's dependency tracking.

3. **A mount seam**, `public/scripts/app/views/CharacterHistoryVueView.js`, 50
   lines. It presents the same interface to the router that a Marionette view
   does - `new View({el})`, then `register(character)` returning a promise - so
   the router does not know which framework renders a given page. That is what
   makes this incremental: one route moves at a time, and reverting one is a
   one-line edit.

## What did not have to move

**The models.** All 3,273 lines of them. `Character.get_transformed`,
`get_recorded_changes`, `update_trait`, the Parse compatibility layer - the Vue
page calls them exactly as the Marionette page does, including `await`ing
`Parse.Promise` (the compat layer's promise is a real thenable). A port that
starts by rewriting the data layer is a rewrite; a port that keeps it is a port.

**The router.** 82 routes, 2,405 lines. It gained one route handler, identical
in shape to the one above it.

**The styling.** The sheet reuses jQuery Mobile's own class names - `ui-bar`,
`ui-grid-b`, `ui-block-a`. Those are plain CSS in the jQM stylesheet, so the
Vue sheet looks like the Marionette sheet without anything ever calling
`enhanceWithin()` on it.

## The one real hazard, and how it is handled

jQuery Mobile *enhancement* rewrites the DOM: it replaces a `<input
type="range">` with a wrapper, a handle div and a paired text input, and it
does that outside Vue's knowledge. Vue's next patch then fights markup it did
not create. That is almost certainly the failure mode behind previous attempts
at this page - it is exactly the shape of "worked, then came apart".

The fix is not a workaround, it is jQM's own opt-out: `data-role="none"` on
form elements, and no `data-role` attributes anywhere in the Vue subtree. jQM
enhances the page shell and then leaves the contents alone. The Vue page has a
native range input; the Marionette page has jQM's slider widget with its number
box. That difference is visible in the two screenshots and is the only visual
difference between them.

## Sizing the rest of the application

The measurable surface:

| | count | lines |
|---|---|---|
| Views (Marionette) | 51 files | 8,947 |
| Templates | 60 files | 1,131 |
| Router | 1 file | 2,405 |
| Models + collections | 33 files | 3,273 |
| Forms (Backform) | 3 files | 106 |
| jQM pages in `index.html` | 60 | 1,114 |

And the coupling that actually sets the price:

| | count |
|---|---|
| `enhanceWithin()` calls | 96 |
| `$.mobile.*` references | 288 |
| `data-role` attributes | 174 |
| jQM `listview` usages | 64 |
| Views touching jQM popups | 1 (`CharacterExperienceView`) |
| `Marionette.ItemView` | 64 |
| `LayoutView` / `CollectionView` / `CompositeView` | 15 / 9 / 1 |

Two observations from those numbers.

**The view code is mostly small and mostly repetitive.** Half the views are
under 100 lines, and 64 of the 89 Marionette classes are `ItemView` - render a
template, listen to one attribute, re-render. That is the single most
mechanical thing to port, and the ratio measured on this page (0.75×, and this
page is one of the *hard* ones) should hold or improve on them.

**The concentration of jQM coupling is the schedule.** 288 `$.mobile`
references and 174 `data-role` attributes are not view code; they are the
navigation model, the loading spinner, the page transitions and the widget set.
A page-at-a-time port leaves that in place and lives inside it, which is what
this page does and what makes it cheap. Replacing it - moving to a real router
with real client-side navigation - is a separate project, and it is the one
that is actually expensive.

An order-of-magnitude read, holding the measured ratio and assuming the data
layer and router stay: **the 51 views are roughly two to three weeks of
sustained work** for someone who already knows the codebase, done a page at a
time behind the seam, with each page verifiable against its predecessor by the
same kind of text-parity test used here. Leaving jQuery Mobile in place for
that whole period is not a compromise; it is the thing that makes it possible.

Three areas that will not fit the average and should be sized separately:

- `CharacterCreateViewNew` (489 lines) and the creation wizard, which is
  stateful across pages.
- `CharacterExperienceView` (353 lines) - the only view driving jQM popups,
  which is the widget with the least pleasant Vue story.
- The 20 files touching Backform. Backform builds DOM from a field
  specification, which is what a Vue component does natively; those forms
  should be *deleted*, not ported, and that is a rewrite of 20 call sites
  rather than a translation.

## Two things found while reading the originals

Not port blockers, but worth writing down.

**Print templates render user text as markup, and it executes.**
`VampirePrintHelper.format_*` builds HTML by string concatenation, and every
print template renders it through `<%= %>`, which in lodash is the *unescaped*
interpolation. Trait names and specialisations are free text typed by players -
`SimpleTraitSpecializationView` reads `input[name="specialization"]` and
concatenates it into the trait name.

This was confirmed live rather than reasoned about. A character given the
specialisation `Lore: <img src=x onerror="window.__injected = true">`, opened at
`#character/<id>/print`, yields one real `<img src="x">` element inside
`#printable-sheet` and `window.__injected === true`. Stored, and it runs on the
screen of anyone who views that sheet, including a storyteller reviewing
someone else's character.

The Vue port is immune by construction - the format helpers return
`{text, tone}` segments and Vue escapes text bindings - and that was checked the
same way. There is deliberately no test for this in `character-history-vue.spec.js`:
a test asserting the Marionette page *does* inject would have to be deleted the
day the bug is fixed, and pinning a defect in place is worse than not testing
it. It wants its own fix and its own regression test.

**The history page's diff highlighting could not work.** `get_transformed`
returns a `transform_description` that the helpers can render as red/green
marks, and `CharacterHistoryView` throws it away with
`c.transform_description = []` before handing the character to the sheet. That
looks like a feature someone gave up on, but discarding it is correct: for an
"update" the helper renders the description's `fake` as the removed value and
the trait now on the character as the added value, and rolling an update back is
precisely what puts the old value on the character. Both halves of the diff
would read the same. The approval page gets away with it because it computes
its description over a *range* of changes rather than over the ones it rolled
back. The Vue port keeps the original's behaviour and records the reason in
`useCharacterHistory.js`.

## How to look at it

```bash
E2E_BASE_PORT=1637 npx playwright test e2e/character-history-vue.spec.js --project=chromium --workers=1
```

(The port override is only needed when another worktree's suite is already
running on the default 1337 range; the two contend for the same backends.)

Or run the app and open a character's history: the Marionette page now carries
a link to the Vue one, and the Vue one links back.
