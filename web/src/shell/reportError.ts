import { useSyncExternalStore } from 'react';
import { Parse } from '@/parse/init';
import { currentFragment } from '@/router/router';

/**
 * The one place that puts a failure where the user is looking.
 *
 * Ports public/scripts/app/helpers/ReportError.js. Its opening comment explains
 * why it exists, and the reason has not changed: the app's long-standing habit
 * is to swallow its own failures -- a bare `.fail(console.log)`, or no failure
 * handler at all -- so a save that 404s looks exactly like a save that worked.
 *
 * The subtle part is that the banner **follows exactly one navigation**.
 * Several failure handlers surface an error and then redirect, so a banner
 * pinned to the page the user is leaving would never be read. It therefore
 * travels to wherever the redirect lands, waits there, and is cleared by the
 * next navigation the user makes -- or by clicking it.
 *
 * e2e/access-control.spec.js:517 asserts `#global-error-region` is visible and
 * that its text matches /administrator access/i after a non-admin is refused,
 * so the id, the visibility and the message are a contract, not a detail.
 */

export const ERROR_REGION_ID = 'global-error-region';

/**
 * Where we are in the follow-the-redirect dance.
 *
 *   idle    nothing showing
 *   follow  showing, and the next navigation should carry it along
 *   settle  showing on its final page; the next navigation clears it
 */
type Phase = 'idle' | 'follow' | 'settle';

let phase: Phase = 'idle';
let message: string | null = null;

/**
 * The URL the banner was raised on, then the one it settled on.
 *
 * The dance is driven by *which* fragment we are on, not by how many times the
 * shell has told us a navigation happened. Counting is not good enough: the
 * shell's effect also fires for the fragment the app loaded with, so on a full
 * page load -- someone opening a deep link they are not allowed to see -- the
 * initial fire consumed a step and the redirect consumed the second, clearing
 * the banner before it was ever painted. Effects also run child-first and React
 * StrictMode double-invokes them on mount, so any counting scheme has to be
 * right under three orderings at once. Comparing fragments is right under all
 * of them.
 */
let raisedOn: string | null = null;
let settledOn: string | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string | null {
  return message;
}

/** The banner text currently showing, or null. */
export function useGlobalError(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function clearError(): void {
  if (phase === 'idle' && message === null) return;
  phase = 'idle';
  message = null;
  raisedOn = null;
  settledOn = null;
  emit();
}

/**
 * Tell the banner which page we are on now. Called by the shell on every route
 * change, including the first.
 *
 * The legacy version keys off the *page element* for the same reason this keys
 * off the fragment: jQuery Mobile fires both `pagecontainershow` and a bubbling
 * `pageshow` for one transition, so counting events would clear the banner the
 * user was meant to read. Being told the same fragment twice is a no-op here.
 */
export function errorRegionOnNavigate(fragment: string): void {
  if (phase === 'idle') return;
  if (phase === 'follow') {
    // Still on the page the failure happened on -- the redirect has not landed.
    if (fragment === raisedOn) return;
    phase = 'settle';
    settledOn = fragment;
    return;
  }
  // phase === 'settle': the next move the user makes clears it.
  if (fragment !== settledOn) clearError();
}

/** Turn whatever was thrown into something a person can read. */
function messageFor(error: unknown): string {
  if (error === undefined || error === null) return 'An unknown error occurred.';
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) return [...new Set(error.map(messageFor))].join('; ');
  if (typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === 'string') return candidate.message;
    if (candidate.error !== undefined) return String(candidate.error);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Report a failure, and keep it a failure.
 *
 * `context` names what was being attempted, so the banner reads "Couldn't save
 * the rule: ..." rather than a bare Parse message.
 *
 * Rethrows on purpose. The legacy version returns a rejected promise for a
 * reason it writes down: a `.fail()` handler that returns a plain value
 * resolves the chain, which is exactly how `.fail(PromiseFailReport).fail(hide
 * _the_loader)` ends up never hiding the loader. In async/await terms, a
 * `catch` block that reports and does not rethrow turns a failure into a
 * success for everything downstream.
 */
export function reportError(error: unknown, context?: string): never {
  // "Not logged in" is not worth a banner: the guard has already put the user
  // on the login screen, which says everything a banner would. PromiseFailReport
  // skips this code for the same reason.
  const code = (error as { code?: number } | null)?.code;
  if (code === Parse.Error.USERNAME_MISSING) {
    throw error;
  }

  const full = context ? `${context}: ${messageFor(error)}` : messageFor(error);
  console.error('ReportError ' + full, error);

  // Re-reporting the message that is already showing does not restart the
  // dance. Two things make this necessary rather than tidy.
  //
  // React StrictMode double-invokes effects on mount, so a screen that reports
  // and redirects from an effect reports twice -- and the second call happens
  // *after* the redirect, which would record the post-redirect page as the one
  // the failure happened on and clear the banner at the next step.
  //
  // The legacy app has the same shape of problem from a different cause: a
  // failure handler that runs on both a `.fail()` and an `.always()` reports
  // twice for one failure.
  if (message === full && phase !== 'idle') throw error;

  message = full;
  phase = 'follow';
  raisedOn = currentFragment();
  settledOn = null;
  emit();

  throw error;
}

/**
 * Report without rethrowing, for the places that genuinely want to carry on.
 *
 * Rare by design. Prefer `reportError`; reach for this only where the legacy
 * code also continued after reporting.
 */
export function showError(error: unknown, context?: string): void {
  try {
    reportError(error, context);
  } catch {
    /* the banner is the point; the throw is not */
  }
}
