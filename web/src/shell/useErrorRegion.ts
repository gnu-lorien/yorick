import { useEffect, type RefObject } from 'react';
import { clearError, useGlobalError, ERROR_REGION_ID } from './reportError';

/**
 * Put the global error banner inside the active page's `div[role="main"]`.
 *
 * A DOM operation rather than a rendered child, and deliberately so: this is
 * what ReportError.js does -- `($main.length ? $main : $page).prepend($region
 * .detach())` -- and it is the only way to place the banner inside a container
 * whose contents come from `dangerouslySetInnerHTML`, which React will not let
 * carry children.
 *
 * The element it builds is the one e2e/access-control.spec.js:517 asserts on:
 * `#global-error-region`, visible, with text matching /administrator access/i.
 * The classes and the inline styling are copied from the original so the banner
 * looks the same.
 */
export function useErrorRegion(mainRef: RefObject<HTMLDivElement | null>): void {
  const message = useGlobalError();

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    // Remove any banner left over from the page we just left. There is exactly
    // one in the document at a time, matching `$("#" + REGION_ID).remove()`.
    document.getElementById(ERROR_REGION_ID)?.remove();
    if (message === null) return;

    const region = document.createElement('div');
    region.id = ERROR_REGION_ID;
    region.setAttribute('role', 'alert');
    region.className = 'error ui-body ui-body-a';
    Object.assign(region.style, {
      margin: '0.5em 0',
      padding: '0.5em',
      border: '1px solid #b00',
      color: '#b00',
      cursor: 'pointer',
    });
    region.textContent = message;
    // Clicking it dismisses it, as in the original.
    region.addEventListener('click', clearError);

    main.prepend(region);

    return () => {
      region.removeEventListener('click', clearError);
      region.remove();
    };
  }, [message, mainRef]);
}
