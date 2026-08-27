import { useEffect, useMemo, useState, type AnchorHTMLAttributes } from 'react';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { cx, positionClass } from '@/jqm/classes';
import { navigate } from '@/router/router';
import { useTroupes } from '@/data/queries';
import type { Troupe } from '@/parse/models/Troupe';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The troupe directory.
 *
 * Ports the `troupes` route handler, views/TroupesListView.js and
 * templates/troupes-list.html, inside the `#troupes-list` page from
 * public/index.html -- the "Create Troupe" list and the `div[role="troupe-list"]`
 * the template is injected into are that page's own scaffolding, so they are
 * part of the DOM this has to reproduce.
 *
 * Three things about the legacy markup look like mistakes and are reproduced
 * anyway, because a port that also fixes things cannot be reviewed:
 *
 * - Every row carries `ul-li-has-thumb`, misspelled in the template (`ul-`, not
 *   `ui-`), so it matches no rule in jquery.mobile-1.4.5.css and does nothing.
 *   jQM then adds the real `ui-li-has-thumb` itself, because the row's first
 *   element is an `<img>` -- see `_addThumbClasses` in jquery.mobile-1.4.5.js.
 * - The row's anchor is `href="#"` with a click handler that assigns
 *   `window.location.hash`, rather than an href of the destination. Middle-click
 *   and "open in new tab" therefore do nothing useful. Kept: the E2E suite reads
 *   the id back off `a.troupe-listing[backendid]` and the CSS keys off the
 *   hand-written `ui-btn` classes.
 * - templates/troupe-list-entry.html is the same row with a real href, but only
 *   PlayerOptionsView uses it; this screen renders the `href="#"` variant.
 *
 * @compare #troupes
 */
export function TroupesList(_: ScreenProps) {
  const { data, isFetching, error } = useTroupes();
  const [filter, setFilter] = useState('');
  const [leaving, setLeaving] = useState(false);
  const { show, hide } = useLoading();

  // The handler brackets the whole route in $.mobile.loading("show") / ("hide"),
  // the hide in an `.always()` so a failed load does not strand the spinner.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // TroupesListView.clicked shows the spinner and then changes the hash,
  // never hiding it -- jQM's loader is a single element, so the destination
  // route's own `hide` clears it. React's is reference-counted, so an unpaired
  // show would stick forever. Hiding on unmount is the same visible behaviour
  // (spinner from the click until the next screen is on the page) and cannot
  // leak, whatever the destination does.
  useEffect(() => {
    if (!leaving) return;
    show();
    return hide;
  }, [leaving, show, hide]);

  const rows = useMemo(() => {
    // collections/Troupes.js sorts by name with lodash `gt`/`lt`, which are bare
    // `>` and `<` on the strings -- so this is code-unit order, not locale
    // order, and "Zed" sorts before "anvil". `each` returns objectId order and
    // Array#sort is stable, so equal names keep it.
    const sorted = [...(data ?? [])].sort((l, r) => (l.name > r.name ? 1 : l.name < r.name ? -1 : 0));

    // jQuery Mobile's filterable matches the row's whole text lowercased, with
    // no trimming of what was typed, and hides non-matches with
    // `ui-screen-hidden` rather than removing them. Refreshing the listview
    // then recomputes ui-first-child/ui-last-child over the visible rows only.
    const needle = filter.toLowerCase();
    const shown = sorted.filter((t) => !needle || rowText(t).toLowerCase().includes(needle));
    const position = new Map(shown.map((t, i) => [t, positionClass(i, shown.length)]));

    return sorted.map((troupe) => ({
      troupe,
      hidden: !position.has(troupe),
      position: position.get(troupe) ?? '',
    }));
  }, [data, filter]);

  return (
    <Page id="troupes-list" title="Troupes">
      <ul>
        <li>
          <a href="#troupe/new">Create Troupe</a>
        </li>
      </ul>
      <div role="troupe-list">
        <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
          <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
            <input
              id="troupes-list-filter"
              data-type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <a
              href="#"
              tabIndex={-1}
              aria-hidden="true"
              title="Clear text"
              className={cx(
                'ui-input-clear ui-btn ui-icon-delete ui-btn-icon-notext ui-corner-all',
                !filter && 'ui-input-clear-hidden',
              )}
              onClick={(e) => {
                e.preventDefault();
                setFilter('');
              }}
            >
              Clear text
            </a>
          </div>
        </form>
        <ul
          data-role="listview"
          data-filter="true"
          data-input="#troupes-list-filter"
          className="ui-listview"
        >
          {rows.map(({ troupe, hidden, position }) => (
            <TroupeRow
              key={troupe.id}
              troupe={troupe}
              hidden={hidden}
              position={position}
              onPick={() => {
                setLeaving(true);
                // The base_url TroupesListView.register defaults to, rendered:
                // "#troupe/<%= troupe_id %>". Nothing in the app passes another
                // one to this page.
                navigate(`troupe/${troupe.id}`);
              }}
            />
          ))}
        </ul>
      </div>
      {/* The legacy chain ends in `.fail(PromiseFailReport)`, which only writes
          to the console and then lets the transition happen anyway, so a failed
          load renders as an empty directory with no explanation. Saying so is
          the one deliberate addition here. */}
      {error ? <p className="error">{String(error)}</p> : null}
    </Page>
  );
}

function TroupeRow({
  troupe,
  hidden,
  position,
  onPick,
}: {
  troupe: Troupe;
  hidden: boolean;
  position: string;
  onPick: () => void;
}) {
  const location = troupe.location;
  const staffemail = troupe.staffemail;

  return (
    <li className={cx('ul-li-has-thumb ui-li-has-thumb', position, hidden && 'ui-screen-hidden')}>
      <a
        href="#"
        // `name` and `backendId` are how e2e/helpers/troupes.js resolves a
        // troupe's id from the directory, and `backendId` is what the legacy
        // click handler itself reads. Written lowercase because HTML attribute
        // names are case-insensitive -- the browser parses the old template's
        // `backendId=` to `backendid` too -- and because React warns otherwise.
        {...({ name: troupe.name, backendid: troupe.id } as AnchorHTMLAttributes<HTMLAnchorElement>)}
        className="ui-btn ui-btn-icon-right ui-icon-carat-r troupe-listing"
        onClick={(e) => {
          e.preventDefault();
          onPick();
        }}
      >
        <img src={troupe.thumbnailUrl(128)} className="troupe-link-portrait" alt="" />
        <h2>
          {troupe.name}
          {location ? ` (${location})` : null}
        </h2>
        <p>{troupe.shortdescription}</p>
        {/* `_.trim(...)` in the template: a whitespace-only staffemail prints no
            line at all, while a set one prints unmodified. */}
        {staffemail.trim() ? <p>{staffemail}</p> : null}
      </a>
    </li>
  );
}

/** What jQM's filter matches against: the row's text, which is every line of it. */
function rowText(troupe: Troupe): string {
  return [troupe.name, troupe.location, troupe.shortdescription, troupe.staffemail]
    .filter(Boolean)
    .join(' ');
}

registerScreen('troupes', TroupesList);
