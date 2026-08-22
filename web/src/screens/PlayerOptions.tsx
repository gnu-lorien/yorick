import { useEffect, type AnchorHTMLAttributes } from 'react';
import { Page } from '@/jqm/Page';
import { Listview, ListItem } from '@/jqm/Listview';
import { Parse } from '@/parse/init';
import { useSession, sessionChanged } from '@/parse/session';
import { useMyTroupes } from '@/data/queries';
import { cx, positionClass } from '@/jqm/classes';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The start page -- what you land on after logging in.
 *
 * Ports templates/player_options.html and the outer layout of
 * views/PlayerOptionsView.js. The Administration entry appears only for a user
 * with `admininterface`, matching the template's own condition.
 *
 * The "Troupe View All Characters" region below the menu is ported too; see
 * TroupeQuickAccess at the bottom of this file.
 *
 * @compare-known (home) -- the legacy quick-access list is empty; see TroupeQuickAccess
 */
export function PlayerOptions(_: ScreenProps) {
  const session = useSession();

  // The `home` handler recomputes storyteller status on every visit and saves
  // it back to the user: it counts the Roles the user belongs to and sets
  // `storytellerinterface` accordingly. This is not incidental -- it is what
  // decides whether the footer shows two tabs or three, so someone promoted to
  // storyteller sees the Troupes tab the next time they pass through here.
  //
  // The legacy `InjectAuthData(user)` call in the same chain is deliberately
  // not ported: it only refreshes a Facebook access token, and Facebook login
  // was removed rather than migrated.
  useEffect(() => {
    const user = Parse.User.current();
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const count = await new Parse.Query(Parse.Role).equalTo('users', user).count();
        const isStoryteller = count > 0;
        if (cancelled || user.get('storytellerinterface') === isStoryteller) return;
        user.set('storytellerinterface', isStoryteller);
        await user.save();
        if (!cancelled) sessionChanged();
      } catch {
        // The legacy chain ends in PromiseFailReport, which reports and stops.
        // A failure here must not block the page: the menu below is still
        // usable, it just may be showing a stale tab count.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Page id="player-options" title="Player Options">
      <Listview inset>
        <ListItem href="#characters?all">Characters</ListItem>
        <ListItem href="#profile">Profile Settings</ListItem>
        {session.admin ? <ListItem href="#administration">Administration</ListItem> : null}
        <ListItem href="#troupes">Troupes</ListItem>
        <ListItem href="#referendums">Referendums</ListItem>
      </Listview>
      <div id="troupe-characters-quick-access">
        <TroupeQuickAccess enabled={session.admin || session.storyteller} />
      </div>
    </Page>
  );
}

/**
 * "Troupe View All Characters" -- the staffed-troupe shortcuts under the menu.
 *
 * Ports the `TroupesView` / `TroupeView` pair inside PlayerOptionsView.js and
 * templates/troupe-list-entry.html.
 *
 * It renders nothing at all for a plain player. That is the original's own
 * guard -- "Don't try to display the troupe characters quick access if we don't
 * think they have any special roles" -- and it matters beyond tidiness: the
 * roles query behind it is a request every player would otherwise make on every
 * visit to the start page for a list that is always empty.
 *
 * THIS DIVERGES FROM THE LEGACY APP, DELIBERATELY, and it is the only place in
 * the migration that does.
 *
 * The legacy list is empty for everyone. It reads the role's name through a
 * doubled property path:
 *
 *     var id = role.attributes.attributes.name;      PlayerOptionsView.js:71
 *
 * Under Parse 1.5 that resolved. Under parse@8 `role.attributes` is the plain
 * attribute bag, so `.attributes` on it is undefined, `id` is undefined, no
 * troupe is ever matched, and the section renders as a heading above an empty
 * <ul>. Measured against the running app with an account that holds
 * LST_<troupeId>: the role and the troupe are both in cache and the lookup
 * succeeds when done with `role.get("name")`, and fails through the path above.
 *
 * So this is a regression the Parse 8 upgrade introduced, not a feature that
 * was meant to be absent -- which is why it is not reproduced. Reproducing it
 * would mean writing code whose purpose is to render nothing. The legacy fix is
 * one word: `role.get("name")`.
 */
function TroupeQuickAccess({ enabled }: { enabled: boolean }) {
  const { troupes, isLoading } = useMyTroupes();
  if (!enabled) return null;

  return (
    <div>
      <h3>Troupe View All Characters</h3>
      {isLoading && <p>Loading Your Troupes...</p>}
      <ul data-role="listview" className="ui-listview">
        {troupes.map((troupe, i) => (
          <li key={troupe.id} className={cx('ul-li-has-thumb', positionClass(i, troupes.length))}>
            <a
              // `name` and `backendid` are not React anchor props -- `name` is
              // deprecated on <a> and `backendid` was never standard -- but
              // troupe-list-entry.html emits both and they are the handles the
              // legacy troupe code reads back off the DOM. Cast, so keeping
              // them is a deliberate statement rather than a type error to
              // route around.
              //
              // Lowercase `backendid`: HTML attribute names are
              // case-insensitive, so the legacy template's `backendId` parses
              // to the same thing, and camelCase makes React warn.
              {...({ name: troupe.name, backendid: troupe.id } as AnchorHTMLAttributes<HTMLAnchorElement>)}
              href={`#troupe/${troupe.id}/characters/all`}
              className="ui-btn ui-btn-icon-right ui-icon-carat-r troupe-listing"
            >
              <img src={troupe.thumbnailUrl(128)} className="troupe-link-portrait" alt="" />
              <h2>
                {troupe.name}
                {troupe.location ? ` (${troupe.location})` : ''}
              </h2>
              <p>{troupe.shortdescription}</p>
              {troupe.staffemail.trim() ? <p>{troupe.staffemail}</p> : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

registerScreen('home', PlayerOptions);
