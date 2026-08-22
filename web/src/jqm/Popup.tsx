import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './classes';

/**
 * jQuery Mobile's popup.
 *
 * Markup harvested from the running legacy app: jQM wraps the popup in a
 * positioned container and puts a full-screen overlay behind it.
 *
 *   <div class="ui-popup-screen ui-overlay-a in" id="{id}-screen"></div>
 *   <div class="ui-popup-container ui-popup-active" id="{id}-popup" style="top; left; max-width">
 *     <div id="{id}" class="ui-popup ui-overlay-shadow"> ... </div>
 *   </div>
 *
 * Positioning is inline style, computed on open, because the stylesheet has no
 * centring rules for it -- `.ui-popup-container` is `position: absolute` with
 * nothing else. So the coordinates below are not a reimplementation of jQM's
 * layout algorithm for its own sake; without them the popup renders at the
 * top-left corner of the document.
 */

export interface PopupProps {
  id: string;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  /** jQM's `data-overlay-theme`; the app always uses "a". */
  overlayTheme?: string;
  /** `data-corners="false"` in the legacy markup switches the rounding off. */
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
  corners = false,
  tolerance = 15,
  className,
}: PopupProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxWidth: number } | null>(null);

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

  if (!open) return null;

  return createPortal(
    <>
      <div className={`ui-popup-screen ui-overlay-${overlayTheme} in`} id={`${id}-screen`} onClick={onClose} />
      <div
        className="ui-popup-container ui-popup-active"
        id={`${id}-popup`}
        style={
          position
            ? { maxWidth: position.maxWidth, top: position.top, left: position.left }
            : // Off-screen for the first paint, so the pre-measurement frame is
              // not visible in the corner.
              { visibility: 'hidden' }
        }
      >
        <div
          ref={boxRef}
          id={id}
          data-role="popup"
          data-overlay-theme={overlayTheme}
          data-corners={corners ? undefined : 'false'}
          data-tolerance={tolerance}
          className={cx('ui-popup ui-overlay-shadow', corners && 'ui-corner-all', className)}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
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
