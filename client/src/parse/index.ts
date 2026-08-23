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
import { installSaveReattachment } from '@/parse/reattach'
import { registerYorickClasses } from '@/parse/classes'

let initialised = false

export function initParse(): typeof Parse {
  if (!initialised) {
    Parse.initialize('APPLICATION_ID', 'yymp8UWnJ7Va32Y2Q4uzvWxfPTYuDvZSA8kdhmdR')
    Parse.serverURL = siteconfig.serverURL

    /*
     * Per-object state, as the Backbone client has.
     *
     * The two load different builds of parse 8.6.0 -- `public/scripts/lib` ships
     * the browser UMD, this imports the npm package -- and they default the
     * state controller differently. Measured with the same probe in both: write
     * to one pointer via `_finishFetch`, then read a second pointer to the same
     * id. The legacy's second pointer sees nothing; this one saw the write.
     *
     * That difference is not academic. `usersStore.hydrate` fills in an owner's
     * display name on the rosters that need one, and under a shared state
     * controller that hydration is GLOBAL and PERMANENT: visit the admin roster
     * once and every `_User` pointer anywhere in the session answers with a
     * username for the rest of the session. A player's own roster then started
     * printing their own name on every row -- redundant by design -- and, worse,
     * it is the same shape as the `include("owner")` defect that made
     * parse-server delete unreadable pointers and `get_me_acl` rewrite ACLs to
     * the viewer. A hydration that leaks past the screen that asked for it is a
     * hazard whatever it happens to do today.
     *
     * So this is deliberate and load-bearing, not a tidy-up.
     */
    Parse.Object.disableSingleInstance()
    /*
     * The other half of that decision, and not optional.
     *
     * Per-object state means a save response's bare pointers really do replace
     * the children already loaded, instead of resolving to the same shared
     * state. `installSaveReattachment` puts them back, exactly as
     * `parse-compat/events.js:385` does for the Backbone client. Without it,
     * saving one attribute leaves the character holding dataless traits and the
     * next edit silently does nothing.
     *
     * Before `installParseReactivity`, so the reactivity bump ends up on the
     * OUTSIDE and screens re-render after the children are back rather than
     * during the window where they are empty.
     */
    installSaveReattachment()
    // Before any object exists, so no instance escapes untracked.
    installParseReactivity()
    registerYorickClasses()
    initialised = true
  }
  return Parse
}

export default Parse
export { Parse }
