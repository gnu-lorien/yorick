import { useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes } from 'react';
import { Page } from '@/jqm/Page';
import { useLoading } from '@/jqm/Loader';
import { cx, positionClass } from '@/jqm/classes';
import { navigate } from '@/router/router';
import { useTroupes } from '@/data/queries';
import { Parse } from '@/parse/init';
import { Character } from '@/parse/models/Character';
import { Troupe } from '@/parse/models/Troupe';
import { troupeIdsOf } from '@/parse/character/acl';
import { initializeTroupeMembership, leaveTroupe } from '@/parse/character/troupeMembership';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { registerScreen, type ScreenProps } from './registry';

/**
 * Picking a troupe from a character: which one to show, join, or leave.
 *
 * Ports `character_list_troupes`, `character_pick_troupe_to_join` and
 * `character_pick_troupe_to_leave` (mobileRouter.js:1873-1929) into the three
 * pages public/index.html declares for them, plus the fourth handler
 * `character_leave_troupe`, which renders nothing and is below.
 *
 * The three pick handlers are one screen. They are the same view --
 * views/TroupesListView.js on templates/troupes-list.html -- rendered into a
 * different page id, pointed at a different destination URL, and filtered by
 * one line:
 *
 *     show/leave  q.containedIn("objectId", c.get_troupe_ids())
 *     join        q.notContainedIn("objectId", c.get_troupe_ids())
 *
 * so the membership list decides everything. `get_troupe_ids` reads a plain
 * property that only `initialize_troupe_membership` fills, which is why this
 * fetches the character and then walks its troupe relation before it can filter
 * anything -- see web/src/parse/character/acl.ts for what an unwalked
 * membership silently costs.
 *
 * The filter runs here rather than on the server. The legacy query is
 * TroupeWreqr's field list plus one `containedIn`, and `useTroupes()` is
 * already that query without the constraint, cached; every troupe is
 * world-readable, so the same rows arrive either way and this way there is one
 * request for the directory instead of one per page. The rows are then
 * partitioned by id, which `containedIn` and `notContainedIn` do server-side.
 *
 * The row markup is a copy of the one in CharactersList's sibling,
 * TroupesList.tsx -- same template, so the same `ul-li-has-thumb` misspelling
 * and the same `href="#"` anchor with a click handler. Two copies of it exist
 * because the component is private to that screen; extracting it is a change to
 * a file this port does not own, and is reported instead.
 *
 * @compare #character/9cYrGGv2w3/troupes
 * @compare #character/9cYrGGv2w3/troupes/join
 * @compare #character/9cYrGGv2w3/troupes/leave
 */
export function CharacterTroupePick({ route }: ScreenProps) {
  const handler = route.entry.handler;
  const cid = route.named['cid'] ?? '';
  const { pageId, action } = PICK_MODES[handler] ?? PICK_MODES['character_list_troupes']!;

  const { data: allTroupes, isFetching } = useTroupes();
  const [filter, setFilter] = useState('');
  const [leavingPage, setLeavingPage] = useState(false);
  /** The character's troupe ids: null until the relation walk has finished. */
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  const { track, show, hide } = useLoading();

  // All three handlers set Back before they fetch, so it works while the page
  // is still loading.
  useBackButton(`#character?${cid}`);

  useEffect(() => {
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      try {
        // `get_character(cid)` in the original, which is the router's cached,
        // include-heavy character load. None of that is needed to filter a
        // troupe list -- only the membership is -- so this reads the row and
        // walks the relation. What is lost is the cache: opening two of these
        // pages in a row walks the relation twice, where the legacy router
        // reuses the character it already holds.
        const character = await track(new Parse.Query(Character).get(cid));
        await track(initializeTroupeMembership(character));
        if (!cancelled) setMemberIds(troupeIdsOf(character));
      } catch (error) {
        // `.fail(PromiseFailReport)`, with the `changePage` inside the `.then`
        // it never reaches: the legacy app logs, stays where it is, and shows
        // no list. Here the route has already changed, so the page is this one
        // -- with the banner saying why it is empty.
        if (!cancelled) showError(error, "Couldn't load the character's troupes");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cid, track]);

  // The handlers bracket the whole route in $.mobile.loading("show") / ("hide"),
  // the hide in an `.always()` so a failed load does not strand the spinner.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // TroupesListView.clicked shows the spinner and changes the hash without ever
  // hiding it -- jQM's loader is one element, so the destination's own `hide`
  // clears it. React's is reference-counted, so hiding on unmount is the same
  // visible behaviour and cannot leak. TroupesList.tsx has the long version.
  useEffect(() => {
    if (!leavingPage) return;
    show();
    return hide;
  }, [leavingPage, show, hide]);

  const rows = useMemo(() => {
    const member = new Set(memberIds ?? []);
    // `containedIn`/`notContainedIn` on objectId, done here. Until the walk has
    // finished nothing is known, so nothing is listed -- which is also what the
    // legacy page shows, since its query has not returned either.
    const mine = memberIds === null ? [] : (allTroupes ?? []).filter((t) => member.has(t.id!) === (action !== 'join'));

    // collections/Troupes.js sorts by name with lodash `gt`/`lt`, which are bare
    // `>` and `<` on the strings -- code-unit order, not locale order, so "Zed"
    // sorts before "anvil". Array#sort is stable, so equal names keep the order
    // `each` returned them in.
    const sorted = [...mine].sort((l, r) => (l.name > r.name ? 1 : l.name < r.name ? -1 : 0));

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
  }, [allTroupes, memberIds, action, filter]);

  return (
    <Page id={pageId} title={PAGE_TITLES[pageId]}>
      {/* index.html gives these three pages nothing but this div; unlike
          #troupes-list there is no "Create Troupe" list above it. */}
      <div role="troupe-list">
        <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
          <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
            {/* The same id on all four pages that render this template. In the
                legacy app all 59 pages are resident at once, so four elements
                share it and `#troupes-list-filter` resolves to whichever is
                first in index.html. Kept: React renders one page at a time, so
                the id is unique here, and changing it would change the markup
                the stylesheet and the suite see. */}
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
                setLeavingPage(true);
                // The base_url each handler passes to `register`, rendered:
                // "#character/<cid>/troupe/<%= troupe_id %>/<action>".
                navigate(`character/${cid}/troupe/${troupe.id}/${action}`);
              }}
            />
          ))}
        </ul>
      </div>
    </Page>
  );
}

/**
 * Take the character out of a troupe, then go back to its sheet.
 *
 * Ports `character_leave_troupe` (mobileRouter.js:1982). It is the only one of
 * the five with no page of its own -- screenMap.ts records `pageId: null` --
 * because it renders nothing: it does the work behind the spinner and sends the
 * browser to `#character?<cid>`.
 *
 * The redirect is in an `.always()`, so it happens whether the leave worked or
 * not, and `.fail(PromiseFailReport)` reports afterwards. The two are swapped
 * here -- report, then navigate -- which shows the same banner in the same
 * place: it is built to follow exactly one redirect. Reporting after the hash
 * has already moved would pin it to the destination instead, and clear it on
 * the user's next move rather than letting them read it there.
 *
 * No `@compare` marker: this handler has no page to compare. Its DOM is
 * whatever `#character?<cid>` renders once the redirect lands.
 */
export function CharacterLeaveTroupe({ route }: ScreenProps) {
  const cid = route.named['cid'] ?? '';
  const tid = route.named['tid'] ?? '';
  const { track } = useLoading();

  useBackButton(`#character?${cid}`);

  // Leaving a troupe rewrites the ACL of the character and of every row it
  // owns, so it must happen exactly once. React StrictMode runs an effect's
  // setup, cleanup and setup again on the same instance in development, and a
  // `cancelled` flag would not help -- the work has already been started. The
  // ref survives that double-invoke, which is what makes it the right guard
  // here and not on the read-only screens.
  const started = useRef(false);

  useEffect(() => {
    if (!cid || !tid) return;
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const character = await track(new Parse.Query(Character).get(cid));
        const troupe = await track(new Parse.Query(Troupe).get(tid));
        await track(leaveTroupe(character, troupe));
      } catch (error) {
        showError(error, "Couldn't leave the troupe");
      } finally {
        navigate(`character?${cid}`);
      }
    })();
  }, [cid, tid, track]);

  return null;
}

/** Which page each pick handler renders, and where a row leads. */
const PICK_MODES: Record<string, { pageId: string; action: 'show' | 'join' | 'leave' }> = {
  character_list_troupes: { pageId: 'character-pick-troupe-to-show', action: 'show' },
  character_pick_troupe_to_join: { pageId: 'character-pick-troupe-to-join', action: 'join' },
  character_pick_troupe_to_leave: { pageId: 'character-pick-troupe-to-leave', action: 'leave' },
};

/** The `data-title` public/index.html gives each of those pages. */
const PAGE_TITLES: Record<string, string> = {
  'character-pick-troupe-to-show': 'Show Troupe',
  'character-pick-troupe-to-join': 'Join Troupe',
  'character-pick-troupe-to-leave': 'Leave Troupe',
};

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
        // troupe's id from a listing, and `backendId` is what the legacy click
        // handler itself reads. Written lowercase because HTML attribute names
        // are case-insensitive -- the browser parses the old template's
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

registerScreen('character_list_troupes', CharacterTroupePick);
registerScreen('character_pick_troupe_to_join', CharacterTroupePick);
registerScreen('character_pick_troupe_to_leave', CharacterTroupePick);
registerScreen('character_leave_troupe', CharacterLeaveTroupe);

/*
 * `character_join_troupe` is deliberately NOT registered here.
 *
 * screenMap.ts gives it `pageId: "troupe"`, and web/src/screens/Troupe.tsx
 * already registers it: the handler renders the troupe page, and the join is
 * the extra step it takes on the way. Troupe.tsx's own comment says the join is
 * not ported because `Character.join_troupe` did not exist yet -- it does now,
 * as `joinTroupe` in web/src/parse/character/troupeMembership.ts.
 *
 * Registering it a second time here would throw "Screen already registered" in
 * a real build, and under Vite's hot reload -- where the registry deliberately
 * does not throw -- it would silently give the route to whichever module the
 * glob in screens/index.ts imported last. So the remaining change belongs in
 * Troupe.tsx, which this port does not own, and is reported instead.
 */
