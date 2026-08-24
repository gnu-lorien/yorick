import { createContext, useContext } from 'react';

/**
 * Whether the fixed header and footer are on screen.
 *
 * A page pads itself by their heights so its content does not sit underneath
 * them, and with no chrome there is nothing to pad for. jQuery Mobile worked
 * this out by measuring the real toolbars on every transition; here the shell
 * knows it already, so it just says.
 *
 * Defaults to true, so a `Page` rendered outside a shell -- in a test, or in
 * the print view -- still lays out as it does in the app.
 */
export const ChromeContext = createContext<boolean>(true);

export function useChrome(): boolean {
  return useContext(ChromeContext);
}
