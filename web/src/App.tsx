import { useEffect, type ReactNode } from 'react';
import { Header, Footer, navTabsFor } from '@/jqm/Toolbar';
import { LoadingProvider } from '@/jqm/Loader';
import { ChromeContext } from '@/jqm/chrome';
import { useHashRoute } from '@/router/useHashRoute';
import { navigate, currentFragment } from '@/router/router';
import { screenMap } from '@/router/screenMap';
import { titleFor } from '@/router/pageTitles';
import { useSession, useLogOut, type Session } from '@/parse/session';
import { useBackTarget } from '@/shell/backButton';
import { errorRegionOnNavigate } from '@/shell/reportError';
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

export function App() {
  const route = useHashRoute();
  const session = useSession();

  // Tell the error banner where we are. A failure that redirects must carry its
  // message to wherever the user lands, or the message is never read; the next
  // move after that clears it. See shell/reportError.ts for why this passes the
  // fragment rather than just signalling that something changed.
  const fragment = route?.fragment ?? '';
  useEffect(() => {
    errorRegionOnNavigate(fragment);
  }, [fragment]);

  if (!route) {
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

  const pageId = screenMap[handler]?.pageId ?? handler;
  const Screen = screenFor(handler);

  return (
    <Shell session={session} pageId={pageId}>
      {Screen ? <Screen route={route} /> : <NotMigrated route={route} />}
    </Shell>
  );
}

function Shell({
  session,
  pageId,
  children,
}: {
  session: Session;
  pageId?: string;
  children: ReactNode;
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
