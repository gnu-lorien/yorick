import { useEffect } from 'react';
import { Page } from '@/jqm/Page';
import { navigate } from '@/router/router';
import { useSession } from '@/parse/session';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The administration menu -- the front door to the thirteen admin destinations.
 *
 * Ports the `administration` handler in mobileRouter.js and the `#administration`
 * block in public/index.html. There is no view file and no template: the markup
 * is thirteen static links that live in index.html, and the handler only gates
 * and transitions.
 *
 * Two things about that markup are deliberate rather than oversights:
 *
 * - It is a bare `<ul>`, not `data-role="listview"`, so jQuery Mobile leaves it
 *   alone and the rows render as plain bullet-point links rather than as the
 *   full-width buttons every other menu in the app uses. `#player-options` one
 *   click away *is* a listview. Reproduced as-is; making this a `Listview`
 *   would look better and would be a different screen.
 * - The first entry, Troupes, points at `#troupes` -- the same page the footer's
 *   Troupes tab reaches, and not an administration route at all.
 *
 * The order is index.html's order, which is not alphabetical and not grouped;
 * the five rule editors happen to sit together in the middle.
 *
 * @compare #administration
 */
export function AdministrationScreen(_: ScreenProps) {
  const session = useSession();

  // `enforce_admin()`, ported. The legacy chain is
  // `enforce_admin().then(changePage).fail(admin_route_failed(...))`, so a
  // non-admin never reaches the transition and `admin_route_failed` sends them
  // to the empty hash instead. The bounce is a push, not a replace, exactly as
  // `window.location.hash = ""` was -- so Back from the start page returns here
  // and bounces again. That is the legacy behaviour and not a typo.
  //
  // The admin bit itself is read from the cached user, as `enforce_admin` does;
  // `enforce_logged_in` is what refreshes it from the Role table, at most once
  // every five minutes, and that guard is App.tsx's.
  const blocked = session.loggedIn && !session.admin;
  useEffect(() => {
    if (!blocked) return;
    // The legacy tail also renders a banner through ReportError into a
    // document-level `#global-error-region`. React has no equivalent yet, so
    // the refusal reaches the console but not the screen; see the port report.
    console.error(
      "ReportError Couldn't open the administration menu: Administrator access is required for that page.",
    );
    navigate('');
  }, [blocked]);

  // Render nothing while the bounce lands. The legacy page element exists in
  // index.html whether or not you may use it, but `changePage` is never called
  // for a non-admin, so the menu is never on screen -- and flashing thirteen
  // admin links at someone who was just refused would undo the point of the
  // guard.
  if (blocked) return null;

  return (
    <Page id="administration" title="Administration">
      <ul>
        <li>
          <a href="#troupes">Troupes</a>
        </li>
        <li>
          <a href="#administration/characters/all">Characters</a>
        </li>
        <li>
          <a href="#administration/characters/summarize">SummarizeCharacters</a>
        </li>
        <li>
          <a href="#administration/users/all">Users</a>
        </li>
        <li>
          <a href="#administration/patronages">Patronages</a>
        </li>
        <li>
          <a href="#administration/patronagescsv">Patronages CSV</a>
        </li>
        <li>
          <a href="#administration/descriptions">Descriptions</a>
        </li>
        <li>
          <a href="#administration/bnsctdbs_kith_rules">Kith Rules</a>
        </li>
        <li>
          <a href="#administration/bnsmetv1_clan_rules">Clan Rules</a>
        </li>
        <li>
          <a href="#administration/bnsmetv1_elder_discipline_rules">Elder Discipline Rules</a>
        </li>
        <li>
          <a href="#administration/bnsmetv1_technique_rules">Technique Rules</a>
        </li>
        <li>
          <a href="#administration/bnsmetv1_ritual_rules">Ritual Rules</a>
        </li>
        <li>
          <a href="#administration/referendums">Referendums</a>
        </li>
      </ul>
    </Page>
  );
}

registerScreen('administration', AdministrationScreen);
