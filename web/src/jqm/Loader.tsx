import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

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
