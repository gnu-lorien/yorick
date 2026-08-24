import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles';
import { installPrintStylesheet } from './styles';
import { initParse } from './parse/init';
import { installTestBridge } from './shell/testBridge';
import { App } from './App';

/**
 * Entry point.
 *
 * The order matters: Parse has to be initialised before anything renders,
 * because `useSession` reads `Parse.User.current()` during its first render and
 * the SDK throws if it is asked anything before `initialize`.
 *
 * The legacy equivalent is app/loadall.js, which does the same three things --
 * configure the SDK, install the router, start the app -- inside two nested
 * `require()` callbacks.
 */

/**
 * The query cache, standing in for the app's three global data singletons
 * (UserWreqr, TroupeWreqr, RoleWreqr).
 *
 * `retry: false` because a failed Parse request is almost always a permission
 * refusal or a validation error, and retrying those just delays the message.
 *
 * `staleTime: 0` because that is what the legacy app does everywhere except
 * those three singletons. Every route handler calls `get_character`, which
 * re-fetches the row; nothing is served from a previous visit. A minute of
 * staleness was tried here and is wrong in a way that is easy to miss: unpick a
 * creation pick and go back to the wizard, and the restored slot is still
 * missing, because the wizard's query was populated before the unpick and had
 * not expired. The E2E suite caught it; the DOM comparison could not, because
 * both apps render correct markup from different data.
 *
 * `gcTime: 0` is the same decision carried through. A stale-but-cached query
 * still hands its old data back *immediately* and refetches behind it, so a
 * screen revisited after a change renders the previous answer for a beat --
 * the discipline picker showed the whole catalogue again after a clan was
 * chosen, because that is what it had shown the last time. Dropping the cache
 * when the last observer goes reproduces what the legacy actually does between
 * routes, which is hold nothing: spinner, fetch, render.
 *
 * One query opts out and keeps a minute: the current user's roles, because
 * RoleWreqr genuinely refuses to re-fetch within a session. It says so for
 * itself in data/queries.ts.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
  },
});

installPrintStylesheet();
initParse();
installTestBridge(queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
