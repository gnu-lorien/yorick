import { useCallback, useSyncExternalStore } from 'react';
import { Parse } from './init';

/**
 * The logged-in user.
 *
 * The legacy app reads `Parse.User.current()` directly from wherever it needs
 * it -- router handlers, views, and `templates/footer.html`, which calls it
 * twice while rendering. That works because Backbone re-rendered on demand;
 * under React the current user has to be state, or the navbar and header do not
 * update when someone logs in or out.
 *
 * `Parse.User.current()` is synchronous and reads localStorage, so this is an
 * external store with a bump on every mutation rather than a fetch.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Bump after anything that changes the session, so subscribers re-read. */
export function sessionChanged(): void {
  revision += 1;
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Another tab logging out writes to localStorage; follow it.
  const onStorage = () => sessionChanged();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * What subscribers watch: a counter, not the user object.
 *
 * `Parse.User.current()` answers with the same instance every time, so a
 * snapshot of the object is `Object.is`-equal to the last one no matter what
 * has been set on it, and `useSyncExternalStore` skips the render. Logging in
 * and out looked fine -- both produce a different object -- and every in-place
 * change was invisible: `admininterface` written back by a role recount, or by
 * a storyteller editing an account that happens to be the current user
 * (`AdministrationUser.tsx`). The screen went on showing the old answer.
 *
 * The counter changes on every `sessionChanged()`, so the render happens and
 * the user is read fresh below.
 */
let revision = 0;

function getSnapshot(): number {
  return revision;
}

/**
 * Reconcile `admininterface` against the Administrator / SiteAdministrator
 * roles, and remember when we last did.
 *
 * `admininterface` is a cached answer stored on the user record, so a player
 * promoted a moment ago still carries `false` and is refused by every admin
 * gate until something recounts. The legacy client recounts inside
 * `enforce_logged_in` on any route, throttled to one query per five minutes
 * (`mobileRouter.js:1535`), and forces one on the refusal path of
 * `enforce_admin` -- because the throttle, which is right for ordinary
 * navigation, is exactly wrong for someone who has just been promoted.
 *
 * Both halves are ported. Without the first, a promoted user in this client
 * would never see the Administration tab at all, since the tab is drawn from
 * the same cached flag and there would be nothing to correct it short of
 * logging out and back in.
 *
 * Only the promotion side is tightened, as in the legacy: a DEMOTED admin goes
 * on seeing the interface until the window expires, which is cosmetic. The
 * server's ACLs are what refuse the writes.
 */
const ADMIN_RECOUNT_THROTTLE_MS = 300000;
let lastAdminCheck = 0;

export async function recountAdminStatus(): Promise<boolean> {
  const user = Parse.User.current();
  if (!user) return false;
  lastAdminCheck = Date.now();

  const admin = new Parse.Query(Parse.Role).equalTo('users', user).equalTo('name', 'Administrator');
  const siteAdmin = new Parse.Query(Parse.Role)
    .equalTo('users', user)
    .equalTo('name', 'SiteAdministrator');
  const isAdministrator = (await Parse.Query.or(admin, siteAdmin).count()) > 0;

  // Compared as booleans, not with the legacy's `!=`. An account that has
  // never held the flag reads as `undefined`, which is loosely unequal to
  // `false` -- so the legacy saves the user on the first navigation of every
  // non-admin session. There is nothing to write there.
  if (!!user.get('admininterface') !== isAdministrator) {
    user.set('admininterface', isAdministrator);
    await user.save();
    sessionChanged();
  }
  return isAdministrator;
}

/** The throttled recount, for ordinary navigation. Fires and forgets. */
export function maybeRecountAdminStatus(): void {
  if (!Parse.User.current()) return;
  if (Date.now() - lastAdminCheck < ADMIN_RECOUNT_THROTTLE_MS) return;
  void recountAdminStatus().catch(() => {
    // A failed recount must not break the navigation it rode in on. The
    // cached flag stands, which is what the legacy does when its own query
    // fails.
  });
}

export interface Session {
  user: Parse.User | null;
  username: string | null;
  /** `admininterface` on the user record. */
  admin: boolean;
  /** `storytellerinterface` on the user record. */
  storyteller: boolean;
  loggedIn: boolean;
}

export function useSession(): Session {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Read during render, like the legacy's own templates and route handlers do.
  // `Parse.User.current()` is a synchronous read of an object the SDK already
  // holds, so this costs nothing and cannot go stale between the two.
  const user = Parse.User.current() ?? null;
  return {
    user,
    username: user ? (user.get('username') as string) : null,
    admin: !!user?.get('admininterface'),
    storyteller: !!user?.get('storytellerinterface'),
    loggedIn: !!user,
  };
}

/** Log in, then tell every subscriber. */
export function useLogIn() {
  return useCallback(async (username: string, password: string): Promise<Parse.User> => {
    const user = await Parse.User.logIn(username, password);
    sessionChanged();
    return user;
  }, []);
}

/**
 * Log out.
 *
 * Swallows a failed round-trip on purpose: the legacy `logout` handler calls
 * `Parse.User.logOut()` and moves on regardless, and a user whose session token
 * the server has already dropped must still end up logged out locally rather
 * than stuck on a screen they cannot leave.
 */
export function useLogOut() {
  return useCallback(async (): Promise<void> => {
    try {
      await Parse.User.logOut();
    } catch {
      /* local session is cleared either way */
    }
    sessionChanged();
  }, []);
}
