import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from './classes';
import { useChrome } from './chrome';

/**
 * A jQuery Mobile page.
 *
 * The legacy app declares 59 of these in index.html and shows exactly one at a
 * time. React renders only the active one, which is the one real behavioural
 * difference in this kit -- and an improvement, since the old app kept all 59
 * in the document and every `$("#some-id")` in a view could reach into a page
 * that was not on screen.
 *
 * `id` and `data-title` are load-bearing, not decoration. The Playwright suite
 * finds the active page by `.ui-page-active` and asserts on its id (see
 * e2e/helpers/jqm-helpers.js), and the header title is read from `data-title`.
 * Both are kept.
 */

/** The fixed header's height, and the fixed footer's. */
const HEADER_HEIGHT = 45;
const FOOTER_HEIGHT = 36;

export interface PageProps {
  /** The page id, matching the legacy `index.html` element it replaces. */
  id: string;
  /** The heading text; jQM read this from `data-title`. */
  title?: string;
  /**
   * Override whether the fixed header and footer are showing. Normally left
   * alone -- the shell supplies it through ChromeContext.
   */
  chrome?: boolean;
  children?: ReactNode;
  /** Extra classes on the content div, for pages that carry their own styling. */
  contentClassName?: string;
  /**
   * Static HTML to place *inside* `div[role="main"]`, with no wrapper element.
   *
   * For the pages whose body is a checked-in HTML template rather than JSX --
   * the privacy notice is the one that matters. The legacy views set it with
   * `$el.find("div[role='main']").html(...)`, so an extra containing div here
   * would nest the whole page one level deeper than the original and change
   * which CSS child selectors apply.
   */
  contentHtml?: string;
}

export function Page({
  id,
  title,
  chrome: chromeProp,
  children,
  contentClassName,
  contentHtml,
}: PageProps) {
  const chromeFromShell = useChrome();
  const chrome = chromeProp ?? chromeFromShell;
  const ref = useRef<HTMLDivElement>(null);

  // jQM sizes the page to the viewport so a short page still fills the screen
  // and the fixed footer sits at the bottom rather than under the content. It
  // recomputed this on resize; so does this.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      el.style.minHeight = `${window.innerHeight - (chrome ? HEADER_HEIGHT + FOOTER_HEIGHT : 0)}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, [chrome]);

  // The document title follows the active page, as `pagecontainertransition`
  // made it do in public/scripts/app/main.js.
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  // jQuery Mobile gave every anchor it did not otherwise handle the `ui-link`
  // class, which is what makes in-content links the theme's link colour.
  // Anchors that belong to another widget -- a listview row, a navbar tab, a
  // link button -- were left alone, and they are recognisable by already
  // carrying a `ui-` class.
  //
  // This is a DOM pass rather than a prop on every anchor for one reason: some
  // of this app's content is injected HTML it does not author, notably the
  // privacy notice. A component-level rule cannot reach inside that; jQM's
  // enhancement pass could, so this one does too. It is additive and
  // idempotent, and runs on every render because the content can change
  // without the page id changing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll('a').forEach((anchor) => {
      const handled = [...anchor.classList].some((c) => c.startsWith('ui-'));
      if (!handled) anchor.classList.add('ui-link');
    });
  });

  return (
    <div
      ref={ref}
      id={id}
      data-role="page"
      data-title={title}
      data-url={id}
      tabIndex={0}
      className="ui-page ui-page-theme-a ui-page-active"
      style={{
        position: 'relative',
        paddingTop: chrome ? HEADER_HEIGHT : 0,
        paddingBottom: chrome ? FOOTER_HEIGHT : 0,
      }}
    >
      {contentHtml !== undefined ? (
        <div
          role="main"
          className={cx('ui-content', contentClassName)}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      ) : (
        <div role="main" className={cx('ui-content', contentClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}
