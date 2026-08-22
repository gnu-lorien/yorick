# Porting a screen

Read this before writing a React screen. It is the working agreement that keeps
50-odd independently written screens looking like one codebase.

## The goal

The React screen must render the **same DOM** as the legacy one: same tags, same
ids, same classes, same nesting. Not "similar" -- the same. That is what lets
`jquery.mobile-1.4.5.min.css` style it unchanged, and it is machine-checkable:

```bash
npm run compare:dom -- "#your/url"
```

A screen is not done until that prints `OK`.

## Find your source

`web/src/router/screenMap.ts` maps every legacy handler to the jQuery Mobile
page it renders and the arguments it receives. The implementation is spread over
three places:

- `public/scripts/app/routers/mobileRouter.js` -- the handler: what it fetches,
  in what order, and what it does on failure.
- `public/scripts/app/views/<Name>View.js` -- the view.
- `public/scripts/app/templates/<name>.html` -- the markup, plus whatever the
  page's own block in `public/index.html` already contains.

Read all three. The handler is where the behaviour lives; the template is where
the markup lives; `index.html` often holds the outer scaffolding the template is
injected into, and that scaffolding is part of the DOM you must reproduce.

## Write it

```tsx
import { Page } from '@/jqm/Page';
import { Listview, ListItem, Divider } from '@/jqm/Listview';
import { registerScreen, type ScreenProps } from './registry';

/**
 * One-line statement of what this screen is.
 *
 * Ports views/FooView.js and templates/foo.html. Then: anything a reader would
 * otherwise have to rediscover -- an ordering that matters, a guard that looks
 * redundant but is not, a field that is deliberately not shown.
 *
 * @compare #foo/url
 */
export function FooScreen({ route }: ScreenProps) {
  const id = route.named['id'];
  return (
    <Page id="foo-page" title="Foo">
      ...
    </Page>
  );
}

registerScreen('foo', FooScreen);
```

- **`<Page id>` must be the `pageId` from `screenMap.ts`.** The Playwright suite
  finds the active page by `.ui-page-active` and asserts on its id. Getting this
  wrong breaks tests that have nothing to do with your screen.
- **`registerScreen` at the bottom of the file**, under the legacy handler's
  name. One handler per call; a screen serving several handlers registers once
  per handler.
- **`@compare` in the doc comment**, one per URL worth checking. Use
  `@compare (home)` for the empty hash. Omit it only if the screen has no URL of
  its own, and say why.

## Use the component kits

`web/src/jqm/` emits jQuery Mobile's post-enhancement markup; `web/src/forms/`
emits Backform's. Which one you need is decided by the legacy view, not by
taste: if the legacy view builds the form with `Backform.Form`, use
`@/forms/Backform`, because Backform's Bootstrap grid markup is what puts the
label beside the field rather than above it. Mixing them changes the layout.

`docs/react-migration/jqm-enhanced-markup.md` documents what each widget's
markup is and where it was captured from. If you need a widget that is not in
the kit, capture it the same way with
`docs/react-migration/harvest-jqm-markup.js` rather than guessing.

Do not hand-write `ui-` classes in a screen when a kit component exists. Plain
in-content anchors need no `ui-link`: `Page` adds it, the way jQM's enhancer
did.

## Keep every handle the tests use

The E2E suite selects on ids, on classes like `.character-list-item`, and on
non-standard attributes like `backendId`. Keep all of them, including ones that
look like leftovers. Write camelCase DOM attributes lowercase (`backendid`) --
HTML attribute names are case-insensitive so the DOM is identical, and React
warns otherwise.

## Port the behaviour, not just the markup

The handler in `mobileRouter.js` does more than fetch. Look for:

- **Order of operations.** Several handlers set the back button before
  fetching, and the back button is part of the screen.
- **`.always()` blocks.** These usually hide the loading spinner, and they run
  on failure too -- deliberately, because hiding it only on success leaves a
  stuck spinner that swallows the next click. Use `useLoading().track()`, which
  cannot forget.
- **Failure handling.** `PromiseFailReport` reports and stops. A screen that
  fails to load should say so, not render blank.
- **Guards.** `enforce_logged_in` is already handled centrally by App.tsx; a
  role check inside the handler is not, and is yours to port.

## When the two apps disagree

`compare:dom` will tell you. Before changing your React code to match, find out
*why* they differ -- it is sometimes the legacy app doing something unintended,
and two of those are already documented in `README.md`. In that case:

**Match the legacy behaviour, and write a comment saying what the original
intended and what it actually does.** Do not "fix" it as part of a port. A
migration that also changes behaviour cannot be reviewed, because every diff has
two possible explanations.

Report anything like this in your summary so it can be listed.

## Before you finish

```bash
npm run typecheck:react
npm run compare:dom -- "#your/url"
```

Both must be clean. Do not run `git commit` -- commits are made centrally, and
concurrent commits fight over the index lock.

## What not to touch

`web/src/jqm/`, `web/src/forms/`, `web/src/App.tsx`, `web/src/router/` and
`web/src/screens/registry.ts` are shared. Prefer not to edit them. If your
screen genuinely needs a new capability there, make the change strictly additive
-- a new optional prop, a new exported component -- so it cannot break a screen
someone else is writing at the same time, and say so in your summary.

The generated files (`routeTable.ts`, `screenMap.ts`, `pageTitles.ts`) are
extracted from the legacy source by `npm run generate:routes`. Never edit them
by hand.

## Comments

Match the surrounding style. Comments here explain *why* -- a decision, a
constraint, a trap -- and cite the legacy file and line when it helps a reader
check the claim. They do not narrate what the next line does. If a piece of code
looks wrong until you know one fact, that fact belongs in a comment.
