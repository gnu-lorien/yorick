import { useEffect } from 'react';
import { useLogOut } from '@/parse/session';
import { navigate } from '@/router/router';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Log out and go back to the start.
 *
 * Ports the `logout` handler (mobileRouter.js:326). It renders nothing -- the
 * legacy handler has no `changePage` at all:
 *
 *     Parse.User.logOut().always(function () {
 *         return hello('facebook').logout();
 *     }).always(function () {
 *         window.location.hash = "";
 *         window.location.reload();
 *     });
 *
 * The Facebook step is not ported. `hello('facebook')` is never initialised --
 * app/loadall.js stopped calling `Parse.FacebookUtils.init()` during the Parse 8
 * work -- so that middle `.always()` runs a logout against an unconfigured
 * provider. It is inside an `.always()`, which is why it has never mattered:
 * whatever it throws is swallowed and the reload happens regardless.
 *
 * The reload is not ported either, and does not need to be. It exists because
 * Backbone had no way to re-run the guards that decide what a logged-out visitor
 * may see; React re-renders on the session change, and App.tsx's guard puts them
 * on the login screen by itself.
 *
 * No `@compare` marker: this route renders no page, so there is nothing to
 * compare. It is covered by the E2E suite's `logout` helper.
 */
export function Logout(_: ScreenProps) {
  const logOut = useLogOut();

  useEffect(() => {
    // `useLogOut` already swallows a failed round trip, so a session the server
    // has dropped still ends up logged out locally rather than stuck.
    void logOut().then(() => navigate('', { replace: true }));
  }, [logOut]);

  return null;
}

registerScreen('logout', Logout);
