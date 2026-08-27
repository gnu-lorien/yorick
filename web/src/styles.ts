/**
 * The legacy app's stylesheets, imported rather than copied.
 *
 * Vite rewrites the `url()` references inside them, so jQuery Mobile's icon
 * sprites and ajax-loader.gif come along without any of them being listed
 * here. That is the reason these are imports and not <link> tags in index.html:
 * a <link> would need the files served from a public directory, which would
 * mean duplicating `public/css/` into `web/public/`.
 *
 * `html.no-js.ui-mobile` and `body.ui-mobile-viewport.ui-overlay-a` in
 * index.html are not decoration either -- jQuery Mobile's CSS hangs the page
 * background and the fixed-toolbar layout off them.
 */
import '@legacy-css/themes/default/jquery.mobile-1.4.5.min.css';
import '@legacy-css/bootstrap-forms.css';
import '@legacy-css/nprogress.css';
import '@legacy-css/vis.min.css';

// Print-only, exactly as index.html loads it (`media="print"`). Imported for
// its URL and linked by hand, because a bare CSS import has no media query and
// would apply the print sheet on screen -- which hides most of the app.
import printableSheetUrl from '@legacy-css/printable_sheet.css?url';

export function installPrintStylesheet(): void {
  if (document.querySelector('link[data-yorick-print]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.media = 'print';
  link.href = printableSheetUrl;
  link.setAttribute('data-yorick-print', '');
  document.head.appendChild(link);
}
