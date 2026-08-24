import { useEffect, useState } from 'react';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { Parse } from '@/parse/init';
import { Character } from '@/parse/models/Character';
import {
  CHANGE_HEADERS,
  fetchChangeLog,
  formatChangeEntry,
  type ChangeHeader,
} from '@/parse/character/recordedChanges';
import { navigate } from '@/router/router';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { registerScreen, type ScreenProps } from './registry';

/**
 * A character's audit log, one page at a time.
 *
 * Ports views/CharacterLogView.js and the `characterLogView` template inside
 * the `#character-log` page in public/index.html.
 *
 * Everything the table shows is a VampireChange row, newest first, read with
 * `skip(start).limit(changeBy)`; the route carries both numbers, which is what
 * makes Previous and Next work by navigation rather than by state.
 *
 * That is also what deletes a whole class of bug. `CharacterLogView` memoises
 * `start` on a singleton view and `mobileRouter._routeGeneration` /
 * `ifCurrent()` exist because two registrations could be in flight at once --
 * a reload replays the hash the document loaded with, and a navigation
 * immediately after adds a second, so the later-resolving call won even when
 * it was the stale one. Measured live: `register(start=0)` then
 * `register(start=20)` 9ms apart while the hash read `/log/0/10`, leaving the
 * view on page 2 under a page-0 URL and Next paging from 20. The view's answer
 * was to read the page back out of the hash and drop any registration that
 * disagreed with it. Here the route *is* the state -- React renders the current
 * match and nothing else -- so there is no memoised page to go stale and no
 * guard to port. The arithmetic below still has to be right, and it is the
 * same arithmetic.
 *
 * Two quirks of that arithmetic are the original's and are kept:
 *
 * - Previous and Next both write a literal `/10` as the new `changeBy`, however
 *   large the current page is. Arrive at `/log/0/25`, press Next, and you land
 *   on `/log/25/10`: the step was 25 but the page size becomes 10.
 * - Next has no upper bound. Pressing it past the end of the log gives an
 *   empty table rather than refusing to move.
 *
 * The legacy handler wraps the whole route in a `$.mobile.loading` pair with
 * the hide in an `.always()`, so a denied fetch cannot strand the spinner --
 * see the comment above `characterlog` in mobileRouter.js:422. `track()` is
 * that guarantee without the pairing.
 *
 * @compare #character/9cYrGGv2w3/log/0/10
 */
export function CharacterLogScreen({ route }: ScreenProps) {
  const cid = route.named['cid'];
  const paging = pagingFromRoute(route.named['start'], route.named['changeBy']);
  // Pulled out as plain numbers so the fetch below can depend on the two values
  // rather than on a fresh object every render.
  const start = paging?.start ?? null;
  const changeBy = paging?.changeBy ?? null;
  const { track } = useLoading();

  const [character, setCharacter] = useState<Character | null>(null);
  const [rows, setRows] = useState<Parse.Object[] | null>(null);

  // `set_back_button("#character?" + cid)` runs before the fetch, so Back
  // works while the log is still loading.
  useBackButton(`#character?${cid}`);

  useEffect(() => {
    if (!cid || start === null || changeBy === null) return;
    let cancelled = false;
    void (async () => {
      try {
        // R30: `register` used to refetch only when `start`, `changeBy` or the
        // character had changed. "Read the log, act, read the log again"
        // passes the identical parameters both times, so the second read
        // silently returned the rows from before the action. Entering the log
        // page is a request to see the log as it is now; always ask. React
        // gives that for free -- the screen is mounted per navigation -- and
        // the effect is keyed on the route's own values so an in-place change
        // of page refetches too.
        const loaded = await track(new Parse.Query(Character).get(cid));
        if (cancelled) return;
        setCharacter(loaded);
        const page = await track(fetchChangeLog(loaded, start, changeBy));
        if (cancelled) return;
        setRows(page);
      } catch (error) {
        if (cancelled) return;
        // mobileRouter.js:436 -- report, then leave for the character list.
        showError(error, "Couldn't open the character log");
        navigate('#characters?all');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, start, changeBy, track]);

  // The legacy view renders nothing at all until its fetch lands -- the
  // template is only run from `render`, which the collection's `reset` fires --
  // so an unloaded page is a bare `div[role="main"]`, not a heading with an
  // empty table under it. Kept.
  const ready = character !== null && rows !== null && paging !== null;

  return (
    <Page id="character-log" title="Character Log">
      {ready ? (
        <>
          <h1>{character.name}</h1>
          {/* `previous ui-btn`, not the source's `previous ui-btn
              ui-btn-icon-left`. Writing `ui-btn` into source markup tells
              `$.fn.buttonMarkup` the element has been enhanced already
              (`classNameToOptions`, jquery.mobile-1.4.5.js:12127), so it reads
              the class list back as options and rebuilds it -- and with no
              icon named, an icon *position* is dropped rather than kept. The
              rebuilt list in the running app is exactly `previous ui-btn`, and
              the absent `ui-shadow` / `ui-corner-all` are read back as
              `shadow: false, corners: false`, which is why these two buttons
              are square and flat. Both class names are also what the E2E
              suite and the legacy event map select on. */}
          <button className="previous ui-btn" onClick={() => goto(cid, previousStart(paging))}>
            Previous
          </button>
          <button className="next ui-btn" onClick={() => goto(cid, nextStart(paging))}>
            Next
          </button>
          {/* The two `hackupdateowner` / `hackdeleteoriginal` buttons in the
              template are inside an HTML comment -- one-off data repairs from
              June 2016, disabled in place. Not ported. */}
          <ChangeTable rows={rows} />
        </>
      ) : null}
    </Page>
  );
}

/** Where Previous goes: back one page, never below zero. */
function previousStart(paging: Paging): number {
  return Math.max(0, paging.start - paging.changeBy);
}

/** Where Next goes: forward one page, with no upper bound. See the class doc. */
function nextStart(paging: Paging): number {
  return paging.start + paging.changeBy;
}

/** Both buttons write a literal `/10` for `changeBy`; see the class doc. */
function goto(cid: string | undefined, start: number): void {
  navigate(`#character/${cid}/log/${start}/10`);
}

interface Paging {
  start: number;
  changeBy: number;
}

/**
 * The page the URL asks for, or null if it does not ask for one.
 *
 * Digits only, because that is the test the legacy view applies: `isLogRoute`
 * and `startFromUrl` both match the hash against
 * `#character\/[^\/]+\/log\/(\d+)\/(\d+)`, and a registration that fails it is
 * dropped without rendering. So `#character/<id>/log/x/10` shows an empty page
 * in the legacy app rather than an error or a default first page, and it shows
 * one here.
 */
function pagingFromRoute(start: string | undefined, changeBy: string | undefined): Paging | null {
  if (!start || !changeBy) return null;
  if (!/^\d+$/.test(start) || !/^\d+$/.test(changeBy)) return null;
  return { start: Number(start), changeBy: Number(changeBy) };
}

/**
 * The twelve-column change table, as jQuery Mobile's reflow table leaves it.
 *
 * Exported for CharacterHistory, which renders the same table from the same
 * rows. It lives here rather than in a module of its own because a new shared
 * file is a shared file, and this migration is being written by several hands
 * at once; CharacterListItem.tsx is the precedent for a component that is not
 * a screen sitting in web/src/screens.
 *
 * `data-role="table"` with no `data-mode` is jQM's reflow mode, and the
 * enhancement it performs is two things: `ui-table ui-table-reflow` on the
 * table, and a `<b class="ui-table-cell-label">` carrying the column's header
 * text prepended inside every cell. That `<b>` is what the responsive
 * stylesheet shows in place of the header row on a narrow screen, so it is
 * markup rather than decoration. Captured from the running app at
 * `#character/9cYrGGv2w3/log/0/10`.
 *
 * The `id="table-column-toggle"` is the template's, and the history page
 * duplicates it across two tables on one page. Invalid HTML and left alone --
 * the id is in the source markup of both templates, and nothing in the app
 * looks it up.
 */
export function ChangeTable({ rows }: { rows: (Parse.Object | undefined)[] }) {
  return (
    <table
      data-role="table"
      id="table-column-toggle"
      className="ui-responsive table-stroke ui-table ui-table-reflow"
    >
      <thead>
        <tr>
          {CHANGE_HEADERS.map((header, i) => (
            <th key={header} data-priority={i + 1} data-colstart={i + 1}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row?.id ?? i}>
            {CHANGE_HEADERS.map((header) => (
              <ChangeCell key={header} row={row} header={header} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangeCell({ row, header }: { row: Parse.Object | undefined; header: ChangeHeader }) {
  return (
    <td>
      <b className="ui-table-cell-label">{header}</b>
      {formatChangeEntry(row, header)}
    </td>
  );
}

registerScreen('characterlog', CharacterLogScreen);
