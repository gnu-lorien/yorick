import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { reportLoading } from '@/shell/testBridge';

/**
 * The global loading spinner.
 *
 * The legacy app calls `$.mobile.loading("show")` / `("hide")` 178 times, in
 * matched pairs around each async chain -- and the pairing is the fragile part.
 * Several of the router's handlers hide the spinner in an `.always()` precisely
 * because an early `.fail()` would otherwise leave it up forever, and
 * `ifCurrent()` in mobileRouter.js deliberately does not guard `.always()` for
 * the same reason.
 *
 * A counter removes the class of bug rather than re-implementing the
 * discipline: overlapping requests nest, and `useLoading()` hands out a
 * `track()` that decrements in a `finally` so no caller can forget.
 */

interface LoadingApi {
  /** Run a promise with the spinner up, whatever the outcome. */
  track: <T>(work: Promise<T>) => Promise<T>;
  /** Manual pairing, for the rare caller that is not promise-shaped. */
  show: () => void;
  hide: () => void;
  active: boolean;
}

const LoadingContext = createContext<LoadingApi | null>(null);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const pending = useRef(0);

  const show = useCallback(() => {
    pending.current += 1;
    setCount(pending.current);
  }, []);

  const hide = useCallback(() => {
    pending.current = Math.max(0, pending.current - 1);
    setCount(pending.current);
  }, []);

  const track = useCallback(
    async <T,>(work: Promise<T>): Promise<T> => {
      show();
      try {
        return await work;
      } finally {
        hide();
      }
    },
    [show, hide],
  );

  /**
   * `ui-loading` on `<html>`, which is what actually makes the spinner appear.
   *
   * The stylesheet has `.ui-loader { display: none }` and shows it only under
   * `.ui-loading` (jquery.mobile-1.4.5.js:1494 adds the class, :1530 removes
   * it). Rendering the loader element without the class puts it in the DOM
   * invisibly -- the app looked as though it never loaded anything, and every
   * "wait for the spinner to clear" in the E2E suite returned instantly and
   * read the page mid-save.
   */
  useEffect(() => {
    reportLoading(count);
    const html = document.documentElement;
    if (count > 0) html.classList.add('ui-loading');
    else html.classList.remove('ui-loading');
    return () => html.classList.remove('ui-loading');
  }, [count]);

  const api = useMemo<LoadingApi>(() => ({ track, show, hide, active: count > 0 }), [track, show, hide, count]);

  return (
    <LoadingContext.Provider value={api}>
      {children}
      {count > 0 && <Loader />}
    </LoadingContext.Provider>
  );
}

export function useLoading(): LoadingApi {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error('useLoading must be used inside a LoadingProvider');
  return ctx;
}

/** jQM's loader element, reproduced exactly. */
export function Loader() {
  return (
    <div className="ui-loader ui-corner-all ui-body-a ui-loader-default" style={{ top: '1px' }}>
      <span className="ui-icon-loading" />
      <h1>loading</h1>
    </div>
  );
}
