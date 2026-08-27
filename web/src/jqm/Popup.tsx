import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './classes';

/**
 * jQuery Mobile's popup.
 *
 * Markup harvested from the running legacy app, in both states. A popup is
 * **always in the document** once its page has been enhanced -- jQM moves its
 * container out to the page element and leaves a `<div id="<id>-placeholder">`
 * where it was declared -- and opening it only changes classes:
 *
 *   closed  <div id="{id}-screen" class="ui-popup-screen ui-overlay-inherit ui-screen-hidden">
 *           <div id="{id}-popup" class="ui-popup-container ui-popup-hidden ui-popup-truncate">
 *   open    <div id="{id}-screen" class="ui-popup-screen ui-overlay-{theme} in">
 *           <div id="{id}-popup" class="ui-popup-container ui-popup-active" style="top; left; max-width">
 *
 * That is why this renders in both states rather than mounting on open. A popup
 * that only exists while open is a different DOM from the legacy app's, and the
 * comparison catches it -- the experience screen has four of them.
 *
 * The two elements are siblings of the page's `div[role="main"]`, not children
 * of it, so they are placed through `<Page popups={...}>` rather than as
 * ordinary content.
 *
 * Positioning is inline style computed on open, because the stylesheet has no
 * centring rules -- `.ui-popup-container` is `position: absolute` with nothing
 * else. Without it an open popup renders at the top-left of the document.
 */

export interface PopupProps {
  id: string;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  /** jQM's `data-overlay-theme`, used for the screen behind an open popup. */
  overlayTheme?: string;
  /** jQM's `data-theme`, which becomes `ui-body-{theme}` on the popup itself. */
  theme?: string;
  /** `data-corners`; the legacy popups that set it use `false`. */
  corners?: boolean;
  /** Distance kept from the viewport edges. jQM's `data-tolerance`. */
  tolerance?: number;
  className?: string;
}

export function Popup({
  id,
  open,
  onClose,
  children,
  overlayTheme = 'a',
  theme,
  corners = false,
  tolerance = 15,
  className,
}: PopupProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxWidth: number } | null>(
    null,
  );

  // Centre it once it has been laid out, so the measurement sees real
  // dimensions. useLayoutEffect, not useEffect: measuring after paint makes the
  // popup visibly jump from the corner to the middle.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = el.getBoundingClientRect();
      setPosition({
        maxWidth: vw - tolerance * 2,
        top: Math.max(tolerance, window.scrollY + (vh - rect.height) / 2),
        left: Math.max(tolerance, (vw - rect.width) / 2),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, tolerance, children]);

  // Escape closes, as jQM's popup did.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        id={`${id}-screen`}
        className={cx(
          'ui-popup-screen',
          open ? `ui-overlay-${overlayTheme} in` : 'ui-overlay-inherit ui-screen-hidden',
        )}
        onClick={open ? onClose : undefined}
      />
      <div
        id={`${id}-popup`}
        className={cx(
          'ui-popup-container',
          open ? 'ui-popup-active' : 'ui-popup-hidden ui-popup-truncate',
        )}
        style={
          open && position
            ? { maxWidth: position.maxWidth, top: position.top, left: position.left }
            : // Off-screen for the first paint, so the pre-measurement frame is
              // not visible in the corner.
              open
              ? { visibility: 'hidden' }
              : undefined
        }
      >
        <div
          ref={boxRef}
          id={id}
          data-role="popup"
          data-overlay-theme={overlayTheme}
          data-theme={theme}
          data-corners={corners ? undefined : 'false'}
          data-tolerance={tolerance}
          className={cx(
            'ui-popup ui-overlay-shadow',
            theme && `ui-body-${theme}`,
            corners && 'ui-corner-all',
            className,
          )}
        >
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * The placeholder jQM leaves where a popup was declared.
 *
 * `<div id="<popupId>-placeholder">`, kept because it is in the legacy DOM at
 * the point the template declared the popup -- which is usually nowhere near
 * where the popup itself ends up.
 */
export function PopupPlaceholder({ id }: { id: string }) {
  return <div id={`${id}-placeholder`} />;
}

/**
 * The header bar and close button the legacy popups all carry.
 *
 * Lifted from app/loadall.js's error popup, which builds it by hand:
 * a `ui-btn-right` close button, then the title.
 */
export function PopupHeader({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div data-role="header" className="ui-header ui-bar-inherit">
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onClose();
        }}
        className="ui-btn ui-corner-all ui-btn-a ui-icon-delete ui-btn-icon-notext ui-btn-right"
      >
        Close
      </a>
      <h2 className="ui-title" role="heading" aria-level={2}>
        {title}
      </h2>
    </div>
  );
}
