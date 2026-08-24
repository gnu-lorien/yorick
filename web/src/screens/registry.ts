import type { ComponentType } from 'react';
import type { RouteMatch } from '@/router/router';

/**
 * Which handlers have a React screen.
 *
 * The legacy router's 75 routed handlers are the migration's unit of work. A
 * handler is done when a component is registered here under its name; until
 * then the shell renders the placeholder, which names the handler and the
 * legacy view still to port. So `npm run migration:status` can just count this
 * map against screenMap.ts and report real progress rather than an estimate.
 */

export interface ScreenProps {
  route: RouteMatch;
}

export type Screen = ComponentType<ScreenProps>;

const screens = new Map<string, Screen>();

/**
 * Register the component for a legacy handler name.
 *
 * Registering twice is an error in a real build: two files claiming the same
 * route means one of them is silently unreachable, and finding that by noticing
 * a screen never appears is expensive.
 *
 * Under Vite's hot reload it is not an error, it is the normal case -- editing
 * this module re-executes every `registerScreen` call in it. Throwing there
 * kills the whole app on every save, which is what made this worth a comment.
 */
export function registerScreen(handler: string, component: Screen): void {
  if (screens.has(handler) && !import.meta.hot) {
    throw new Error(`Screen already registered for handler "${handler}"`);
  }
  screens.set(handler, component);
}

export function screenFor(handler: string): Screen | undefined {
  return screens.get(handler);
}

export function registeredHandlers(): string[] {
  return [...screens.keys()].sort();
}
