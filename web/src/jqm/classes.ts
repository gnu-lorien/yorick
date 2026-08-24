/**
 * The class vocabulary jQuery Mobile 1.4.5 applies during enhancement.
 *
 * These are not styling decisions. Every string here was read off the DOM of
 * the running legacy app after `.enhanceWithin()`; see
 * docs/react-migration/jqm-enhanced-markup.md for the captured samples and
 * docs/react-migration/harvest-jqm-markup.js to re-capture them. The React
 * components emit this markup so `jquery.mobile-1.4.5.min.css` styles the new
 * app byte-identically to the old one.
 */

/** Join class names, dropping anything falsy. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Where a button's icon sits relative to its label. */
export type IconPos = 'left' | 'right' | 'top' | 'bottom' | 'notext';

/** jQM theme swatches. The app only ever uses "a" and, for popups, "none". */
export type Theme = 'a' | 'b' | 'none';

/**
 * The icon class pair for a button.
 *
 * jQM writes both halves or neither: `ui-icon-<name>` picks the sprite and
 * `ui-btn-icon-<pos>` reserves the space for it. An icon with no position
 * still gets one, because the CSS keys the padding off the position class.
 */
export function iconClasses(icon?: string | false, pos: IconPos = 'left'): string {
  if (!icon) return '';
  return `ui-icon-${icon} ui-btn-icon-${pos}`;
}

/** `ui-btn` plus the shadow and corner classes jQM gives a standalone button. */
export function buttonClasses(opts: {
  icon?: string | false;
  iconpos?: IconPos;
  inline?: boolean;
  theme?: Theme;
  corners?: boolean;
  shadow?: boolean;
  className?: string;
} = {}): string {
  const { icon, iconpos = 'left', inline, theme, corners = true, shadow = true, className } = opts;
  return cx(
    'ui-btn',
    theme && `ui-btn-${theme}`,
    iconClasses(icon, iconpos),
    shadow && 'ui-shadow',
    corners && 'ui-corner-all',
    inline && 'ui-btn-inline',
    className,
  );
}

/**
 * The per-child position classes jQM stamps onto list items and controlgroups.
 *
 * They drive the corner rounding on an inset list, which is why they have to be
 * recomputed whenever the visible set changes -- a filtered list rounds the
 * first and last *visible* rows, not the first and last rows that exist.
 */
export function positionClass(index: number, total: number): string {
  return cx(index === 0 && 'ui-first-child', index === total - 1 && 'ui-last-child');
}
