/**
 * The Parse SDK, initialised once for the whole app.
 *
 * This replaces the bootstrap half of `public/scripts/app/loadall.js`, and it
 * is deliberately much smaller than what it replaces:
 *
 * - No `Parse.$ = $`. The SDK only needed a jQuery handle for its Backbone-era
 *   view/router layer, none of which survives the migration.
 * - No `parse-compat` shim. That shim exists to give SDK 8 back the Parse 1.5
 *   surface the old front end was written against -- `Parse.Collection`,
 *   `Parse.Router`, `Parse.Promise`, and change events on `Parse.Object`. Vue
 *   Router replaces the router, reactive stores replace the collections, native
 *   promises replace `Parse.Promise`, and Vue's reactivity replaces the change
 *   events, so nothing in the new client depends on the shim. `Parse.Object`
 *   and `Parse.Query` -- the parts that actually talk to the server -- are
 *   untouched by it and are imported straight from the npm package here.
 * - No Facebook login. Removed, not migrated: the owner's explicit call, and it
 *   was already half-removed on greensboro where the buttons are hidden.
 *
 * The application id and JavaScript key are the same literals the old client
 * shipped; they are public by design in a Parse client and are what `index.js`
 * expects.
 */
import Parse from 'parse'
import siteconfig from '@/config/siteconfig'
import { installParseReactivity } from '@/parse/reactivity'
import { registerYorickClasses } from '@/parse/classes'

let initialised = false

export function initParse(): typeof Parse {
  if (!initialised) {
    Parse.initialize('APPLICATION_ID', 'yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR')
    Parse.serverURL = siteconfig.serverURL

    /*
     * The single-instance state controller stays ON here, which is the SDK's
     * own default for a browser build and NOT what the Backbone client does.
     *
     * The two load different builds of parse 8.6.0 -- `public/scripts/lib`
     * ships the browser UMD, this imports the npm package -- and
     * `parse-compat/index.js:123` turns single instance off for the legacy
     * client, because Parse 1.5 had no object registry. It is tempting to
     * match that here. It was tried, and it is wrong for this client. The
     * measurements are in `singleInstance.spec.ts`; the short version:
     *
     * Turning it off costs two things, and only one of them is fixable by the
     * re-attach wrap the compat layer carries.
     *
     *   1. A save response's bare pointers unfetch children already loaded.
     *      `parse-compat/events.js:385` fixes exactly this, and that wrap was
     *      ported and did work.
     *   2. `Parse.Object.fetchAllIfNeeded` hands back objects that are still
     *      unfetched. The wrap does not touch this path, and `calculate_total_
     *      cost` goes straight through it -- so the costs view rendered rows
     *      with an empty name and `_getServerData()` completely empty, and the
     *      four "costs view reconciles" tests failed across every venue.
     *      Measured by reverting and rebuilding: the same row came back as
     *      `Athletics: 3` with all ten fields present.
     *
     * The hazard that motivated turning it off was real -- `usersStore.hydrate`
     * writing an owner's display name into a pointer, where a shared state
     * controller makes that hydration global and permanent for the session.
     * But the fix for THAT is to decide the owner line per screen, which
     * `CharacterSummary` now does explicitly, rather than to change the object
     * model underneath the whole app and depend on a hydration not leaking.
     *
     * If this is ever revisited, both costs above have to be paid, not just the
     * first, and the gate has to be run against a REBUILT bundle -- see
     * `e2e/global-setup.js` on why that is not automatic history.
     *
     * Stated EXPLICITLY rather than left to the default, because the default is
     * not one thing: the SDK picks it as `!CoreManager.get('IS_NODE')`
     * (`parse-8.6.0.js:43086`). So a browser gets shared state and vitest, which
     * runs under node even with the jsdom environment, gets per-object state --
     * and the unit suite would be exercising a different object model from the
     * one that ships. Saying it out loud makes the two agree.
     */
    Parse.Object.enableSingleInstance()
    // Before any object exists, so no instance escapes untracked.
    installParseReactivity()
    registerYorickClasses()
    initialised = true
  }
  return Parse
}

export default Parse
export { Parse }
