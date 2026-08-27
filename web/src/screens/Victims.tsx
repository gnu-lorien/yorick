import { Page } from '@/jqm/Page';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The victims listing.
 *
 * Ports the `victims` route handler and the `#victims-all` page in
 * index.html. There is no view file and no template: the handler is three
 * lines that change page, and the page's whole body is a static `<ul>` of
 * three labels written directly into index.html.
 *
 * The `<ul>` is deliberately not a `Listview`. It carries no
 * `data-role="listview"` in index.html, so jQuery Mobile's enhancer skipped
 * it and the rows render as plain `<li>` with no `ui-` classes at all --
 * confirmed against the running app. Using the kit here would add
 * `ui-listview`/`ui-li-static` and change how the page looks.
 *
 * Nothing is fetched. The three labels are not links, not filters and not
 * bound to any Parse class; whatever "victims" was going to be, this screen
 * only ever showed the headings for it.
 *
 * Two divergences worth knowing about, both from the legacy handler being
 * thinner than the shell around it:
 *
 * - The handler is a bare `if ("all" == type)` with no else, so
 *   `#victims?idle` and `#victims?occupied` -- the two other labels the page
 *   itself advertises -- are no-ops that leave whichever page was showing on
 *   screen. React's shell always renders a screen for a matched route, so
 *   those URLs land here too. Same treatment as CharactersList, which has the
 *   identical guard.
 * - The handler never calls `enforce_logged_in`, so in the legacy app this
 *   page is reachable logged out. App.tsx guards every handler that is not in
 *   its public list, so React sends a logged-out visitor to the login screen.
 *   That is a shell-level decision, not this screen's to make.
 *
 * @compare #victims?all
 */
export function VictimsScreen(_: ScreenProps) {
  return (
    <Page id="victims-all" title="VictimsAll">
      <ul>
        <li>All</li>
        <li>Idle</li>
        <li>Occupied</li>
      </ul>
    </Page>
  );
}

/**
 * The `category` route, which has never done anything.
 *
 * `screenMap.ts` records `pageId: null` for it, and that is not an omission in
 * the generator -- the handler transitions to a page id it computes at
 * runtime, so there is no literal to extract.
 *
 * What it was meant to do (mobileRouter.js:1842): look up `this[type +
 * "View"]`, fetch its collection if empty, and `changePage("#" + type)` to
 * `#animals`, `#colors` or `#vehicles`. Those three pages are still in
 * index.html with a header and an empty inset listview, `CategoryView.js`
 * still renders `script#categoryItems` into them, and
 * `CategoriesCollection.js` still holds the thirteen hard-coded rows -- Pets,
 * Farm Animals, Blue, Green, Cars, Planes and the rest. It is the sample data
 * from the jQuery Mobile + Backbone starter this app was scaffolded from.
 *
 * What it actually does: nothing. No `animalsView`, `colorsView` or
 * `vehiclesView` is ever assigned -- `CategoryView` is not instantiated
 * anywhere in the codebase, and `CategoriesCollection` is imported into
 * mobileRouter.js and never used. So `this[type + "View"]` is `undefined` and
 * the first statement throws `Cannot read properties of undefined (reading
 * 'collection')`, for every `type`. Verified against the running app at
 * `#category?animals`, `#category?colors` and `#category?nope`: each one
 * throws, no page transition happens, and the page that was already on screen
 * stays there.
 *
 * So the port is to render nothing. Reproducing the throw would be theatre,
 * and rendering `#animals` would be implementing a screen that has never
 * existed for a user -- a behaviour change wearing a port's clothes. React
 * cannot leave the previous screen up the way the failed transition does,
 * because the shell unmounts it; an empty page is as close as the shell gets.
 *
 * No `@compare` URL: the two apps cannot agree on a page id when the legacy
 * app's answer is "whichever page you were looking at before".
 */
export function CategoryScreen(_: ScreenProps) {
  return null;
}

registerScreen('victims', VictimsScreen);
registerScreen('category', CategoryScreen);
