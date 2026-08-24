import Parse from 'parse';
import { APPLICATION_ID, JAVASCRIPT_KEY, siteconfig } from '@/config/siteconfig';

/**
 * Parse SDK bootstrap.
 *
 * The legacy app reaches the SDK through `public/scripts/lib/parse-compat/`, a
 * ~250-line shim that puts Parse 1.5's API back on top of Parse 8:
 * `Parse.Promise`, Backbone-style change events on `Parse.Object`,
 * `Parse.Collection`, `Parse.Router` and `Parse.History`. Every one of those
 * exists to serve Backbone and Marionette.
 *
 * React needs none of it, so the React app imports the SDK directly and the
 * shim does not come across. That is the single largest simplification in this
 * migration: promises are native, change notification is React state, the
 * router is web/src/router, and collections are plain arrays from a query.
 *
 * `Parse.serverURL` must be set before any request; see siteconfig.ts for why
 * it carries an explicit "/1".
 */

/**
 * Unique instances, not one shared object per objectId.
 *
 * parse@8 defaults to single-instance in a browser: two reads of the same row
 * give you the same object, and a pointer to a row you already hold resolves to
 * that live object rather than to a stub. The legacy app turns this off
 * (lib/parse-compat/index.js) and this keeps it off, for one of the two reasons
 * the original gives.
 *
 * The reason that does NOT apply is Backbone's: half the legacy views decide
 * whether to re-render by comparing object identity, so a shared instance made
 * them skip the redraw. React re-renders from props and state and does not care.
 *
 * The reason that does apply is Character.update_trait, which builds
 * `new TempVampire({id: self.id})` as a bare pointer (Character.js:199). Under
 * single-instance that "pointer" shares state with the live, dirty character,
 * so encoding it drags the whole unsaved graph into the request.
 *
 * It is also what keeps the two front ends showing the same thing. An
 * unresolved owner pointer reads as having no username, and
 * character-list-item.html prints the owner line only when there is one -- so
 * with single-instance on, a player's own roster grows an owner line that the
 * legacy app never shows.
 *
 * At module scope, not inside initParse(): the model modules call
 * `Parse.Object.registerSubclass` while they are being imported, which happens
 * before any function in this file is called. The original has the same
 * requirement -- "First, before any subclass is registered or any object built".
 */
Parse.Object.disableSingleInstance();

let initialised = false;

export function initParse(): typeof Parse {
  if (initialised) return Parse;
  Parse.initialize(APPLICATION_ID, JAVASCRIPT_KEY);
  Parse.serverURL = siteconfig.serverURL;
  initialised = true;

  // The Playwright suite waits on `window.Parse.applicationId` to decide the
  // app has booted (e2e/helpers/jqm-helpers.js `waitForAppReady`), and several
  // specs read and write `window.Parse.User.current()` directly. Exposing it
  // keeps those working against the React app unchanged.
  (window as unknown as { Parse: typeof Parse }).Parse = Parse;

  return Parse;
}

export { Parse };
