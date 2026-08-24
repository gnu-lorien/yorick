import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Header, Footer, navTabsFor } from '@/jqm/Toolbar';
import { LoadingProvider } from '@/jqm/Loader';
import { ChromeContext } from '@/jqm/chrome';
import { useHashRoute } from '@/router/useHashRoute';
import { navigate, currentFragment } from '@/router/router';
import { screenMap } from '@/router/screenMap';
import { titleFor } from '@/router/pageTitles';
import {
  useSession,
  useLogOut,
  maybeRecountAdminStatus,
  recountAdminStatus,
  type Session,
} from '@/parse/session';
import { useBackTarget } from '@/shell/backButton';
import { errorRegionOnNavigate, showError } from '@/shell/reportError';
import { useScreenGeneration } from '@/shell/testBridge';
import { screenFor } from '@/screens/registry';
import { NotMigrated, NoRoute } from '@/screens/NotMigrated';
import { LoginScreen } from '@/screens/Login';
import '@/screens/index';

/**
 * The application shell.
 *
 * Replaces three things the legacy app kept apart: `index.html`'s fixed header
 * and footer, the `pagecreate` / `pagecontainertransition` handlers in
 * app/main.js that showed, hid and re-titled them, and `enforce_logged_in` in
 * mobileRouter.js.
 *
 * Putting them together is what makes the chrome correct by construction. In
 * the old app the header title, the active navbar tab and the log-out button's
 * label were each written by a different piece of code at a different moment,
 * which is why the title could lag behind a transition.
 */

/**
 * Routes reachable without a session.
 *
 * Everything else is guarded. In the legacy router that guard is spread out:
 * 20 handlers call `enforce_logged_in` directly and another 35 inherit it
 * through `get_character`, which begins with it. The five here reach neither.
 */
const PUBLIC_HANDLERS = new Set(['signup', 'about', 'privacy_policy', 'resetpassword', 'logout']);

/**
 * Routes that require `admininterface`, and what happens without it.
 *
 * The legacy gates these two ways and the difference is visible, so both are
 * kept. Fourteen call `enforce_admin()`, whose failure tail reports
 * "Administrator access is required for that page." and sends the visitor home;
 * four -- the user and patronage listings -- are a bare `if (is_ad) {...}` with
 * no else, so nothing happens at all: no page, no message, and the hash left
 * pointing at a route that did not run.
 *
 * The gap this closes is not theoretical. Without it a non-admin who types the
 * URL gets the whole admin screen rendered at them, and only discovers the
 * refusal when a save comes back forbidden. Most of these are protected
 * server-side, so it was information disclosure and confusion rather than a
 * breach -- which is exactly what the legacy comment at
 * mobileRouter.js:1537 says about the same problem.
 */
const ADMIN_HANDLERS = new Map<string, 'redirect' | 'silent'>([
  ['administration', 'redirect'],
  ['administration_characters_all', 'redirect'],
  ['administration_characters_summarize', 'redirect'],
  ['administration_referendums', 'redirect'],
  ['administration_referendum', 'redirect'],
  ['administration_user_patronages', 'redirect'],
  ['administration_patronage', 'redirect'],
  ['administration_patronage_new', 'redirect'],
  ['administration_descriptions', 'redirect'],
  ['administration_bnsctdbs_kith_rules', 'redirect'],
  ['administration_bnsmetv1_clan_rules', 'redirect'],
  ['administration_bnsmetv1_elder_discipline_rules', 'redirect'],
  ['administration_bnsmetv1_technique_rules', 'redirect'],
  ['administration_bnsmetv1_ritual_rules', 'redirect'],
  ['administration_users', 'silent'],
  ['administration_user', 'silent'],
  ['administration_patronages', 'silent'],
  ['administration_patronages_csv', 'silent'],
]);

export function App() {
  const route = useHashRoute();
  const session = useSession();
  // Bumped only by the E2E bridge, to remount a screen without a navigation.
  // See shell/testBridge.ts.
  const generation = useScreenGeneration();

  // Tell the error banner where we are. A failure that redirects must carry its
  // message to wherever the user lands, or the message is never read; the next
  // move after that clears it. See shell/reportError.ts for why this passes the
  // fragment rather than just signalling that something changed.
  const fragment = route?.fragment ?? '';
  useEffect(() => {
    errorRegionOnNavigate(fragment);
  }, [fragment]);

  // Every page opens at the top, which is what jQuery Mobile's `changePage`
  // does on the way in (`_maybeDegradeTransition` -> `_cssTransition`, which
  // calls `silentScroll(0)` unless the page names its own offset).
  //
  // React changes the hash and nothing moves the viewport, so a screen reached
  // from halfway down a long page opened halfway down itself -- clicking a
  // rating-4 skill in the creation wizard landed a quarter of the way into the
  // list of skills.
  //
  // A screen that wants a different offset sets it after this: the creation
  // wizard restores where the player was in a layout effect once its content
  // has loaded, which is strictly later than this passive one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [fragment]);

  // `enforce_logged_in` recounts the administrative roles on any route, at most
  // once every five minutes, and writes the answer back onto the user. Without
  // it a promoted player never sees the Administration tab, because the tab is
  // drawn from the cached flag. Throttled inside, and never awaited: it is a
  // correction, not a precondition.
  useEffect(() => {
    maybeRecountAdminStatus();
  }, [fragment]);

  if (!route) {
    // `#login` matches no route in either app, and in both it shows the login
    // page anyway. In the legacy that is jQuery Mobile, not Backbone: jQM's own
    // hashchange handler transitions to the element whose id matches the hash,
    // which is how `enforce_logged_in`'s `changePage("#login")` and a
    // hand-typed `#login` both land on the same screen.
    //
    // Only this one id is reproduced. jQM would do it for all 59 page ids, but
    // every other one shows an *empty* page -- nothing has rendered into it --
    // so a general rule would faithfully reproduce a blank screen and lose the
    // "no such route" message that is more useful than either.
    if (currentFragment() === 'login') {
      return (
        <Shell session={session}>
          <LoginScreen />
        </Shell>
      );
    }
    return (
      <Shell session={session}>
        <NoRoute fragment={currentFragment()} />
      </Shell>
    );
  }

  const handler = route.entry.handler;

  // Not logged in on a guarded route: show the login page without touching the
  // hash, exactly as `enforce_logged_in` does with
  // `changePage("#login", { changeHash: false })`. Keeping the hash is what
  // lets someone follow a deep link, log in, and arrive where they meant to.
  if (!PUBLIC_HANDLERS.has(handler) && !session.loggedIn) {
    return (
      <Shell session={session}>
        <LoginScreen route={route} />
      </Shell>
    );
  }

  const adminGate = ADMIN_HANDLERS.get(handler);
  if (adminGate && !session.admin) {
    return <AdminGate mode={adminGate} session={session} />;
  }

  const pageId = screenMap[handler]?.pageId ?? handler;
  const Screen = screenFor(handler);

  return (
    <Shell session={session} pageId={pageId}>
      {Screen ? (
        // Keyed on the generation ALONE, not on the fragment. Keying on the
        // fragment too would remount every screen on every navigation, which
        // is a real behaviour change -- moving between two characters would
        // stop reusing the mounted sheet -- smuggled in under a test hook.
        <Screen key={generation} route={route} />
      ) : (
        <NotMigrated route={route} />
      )}
    </Shell>
  );
}

/**
 * The cached "not an admin" is never the last word.
 *
 * `enforce_admin` recounts the roles before refusing, and only on the path
 * that was about to refuse anyway, so the five-minute throttle still spares
 * every ordinary navigation. The case it exists for: someone promoted a moment
 * ago carries a stale `false` AND a throttle window that suppresses the very
 * recount that would clear it, and is turned away for up to five minutes with
 * no way to hurry it along.
 *
 * Nothing renders while the count is in flight -- not the admin screen, which
 * would be a flash of a page they may not be allowed, and not the refusal,
 * which may be about to be wrong. If the recount says yes it writes the flag,
 * `useSession` re-reads, and this component is gone before it renders again.
 */
function AdminGate({ mode, session }: { mode: 'redirect' | 'silent'; session: Session }) {
  const [refused, setRefused] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    recountAdminStatus()
      .then((isAdmin) => {
        // On `true` the session bump re-renders the app past this gate; there
        // is nothing to do here but stay out of the way.
        if (!isAdmin) setRefused(true);
      })
      .catch(() => setRefused(true));
  }, []);

  if (!refused) return <Shell session={session} />;
  return <AdminRefusal mode={mode} session={session} />;
}

/**
 * What a non-admin gets instead of an admin screen.
 *
 * `redirect` reproduces `admin_route_failed`: say why, then go home. `silent`
 * reproduces the four bare `if (is_ad)` gates, which render nothing and leave
 * the hash where it is -- in the legacy that means the previously visited page
 * stays on screen, because jQuery Mobile keeps every page in the document and
 * simply does not transition. React unmounts, so what is left is an empty
 * shell. The refusal is the same; only the scenery behind it differs.
 */
function AdminRefusal({ mode, session }: { mode: 'redirect' | 'silent'; session: Session }) {
  useEffect(() => {
    if (mode !== 'redirect') return;
    showError(
      new Error('Administrator access is required for that page.'),
      "Couldn't open that page",
    );
    navigate('', { replace: true });
  }, [mode]);

  return <Shell session={session} />;
}

function Shell({
  session,
  pageId,
  children,
}: {
  session: Session;
  pageId?: string;
  children?: ReactNode;
}) {
  const logOut = useLogOut();
  const backTarget = useBackTarget();
  const title = pageId ? titleFor(pageId) : '';

  // Header and footer stay hidden until someone is logged in -- app/main.js
  // does this on `pagecreate`, and it is why the login screen has no chrome.
  const chrome = session.loggedIn;

  const onLogout = () => {
    void logOut().then(() => navigate('', { replace: true }));
  };

  return (
    <LoadingProvider>
      <ChromeContext.Provider value={chrome}>
        {chrome && (
          <Header
            title={title}
            username={session.username ?? undefined}
            backHref={backTarget ?? undefined}
            onLogout={onLogout}
          />
        )}
        {children}
        {chrome && (
          <Footer
            tabs={navTabsFor({ admin: session.admin, storyteller: session.storyteller })}
            activeLabel={title}
          />
        )}
      </ChromeContext.Provider>
    </LoadingProvider>
  );
}
