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
 * `staleTime` of a minute matches how the originals behaved: they fetched once
 * and served the same collection for the rest of the session, and RoleWreqr
 * went further and refused to re-fetch at all unless the user id changed.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false },
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
