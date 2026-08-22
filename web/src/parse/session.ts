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
  cachedUser = undefined;
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

// `undefined` means "not read yet"; `null` means "read, nobody logged in".
let cachedUser: Parse.User | null | undefined;

function getSnapshot(): Parse.User | null {
  if (cachedUser === undefined) cachedUser = Parse.User.current() ?? null;
  return cachedUser;
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
  const user = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
