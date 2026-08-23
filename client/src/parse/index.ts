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
    // Before any object exists, so no instance escapes untracked.
    installParseReactivity()
    registerYorickClasses()
    initialised = true
  }
  return Parse
}

export default Parse
export { Parse }
