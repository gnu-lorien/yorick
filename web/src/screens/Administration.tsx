import { useEffect } from 'react';
import { Page } from '@/jqm/Page';
import { Listview, ListItem } from '@/jqm/Listview';
import { navigate } from '@/router/router';
import { showError } from '@/shell/reportError';
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
 * One thing about that markup is deliberate rather than an oversight: the first
 * entry, Troupes, points at `#troupes` -- the same page the footer's Troupes tab
 * reaches, and not an administration route at all.
 *
 * It used to be a bare `<ul>` here, because it was a bare `<ul>` there: jQuery
 * Mobile left it alone and the rows rendered as bullet-point links rather than
 * the full-width buttons every other menu in the app uses, with
 * `#player-options` one click away being a proper listview. That was legacy bug
 * #11 and it is fixed -- index.html now carries `data-role="listview"
 * data-inset="true"`, and "SummarizeCharacters" has gained its missing space.
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
    // The banner follows the bounce and settles on the start page, which is
    // ReportError's whole point: a message pinned to the page the user is
    // being sent away from would never be read.
    //
    // showError rather than reportError: there is nothing here to rethrow into.
    // e2e/access-control.spec.js:517 asserts this banner is visible and that
    // its text matches /administrator access/i, so the wording is a contract.
    showError(
      'Administrator access is required for that page.',
      "Couldn't open the administration menu",
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
      <Listview inset>
        <ListItem href="#troupes">Troupes</ListItem>
        <ListItem href="#administration/characters/all">Characters</ListItem>
        <ListItem href="#administration/characters/summarize">Summarize Characters</ListItem>
        <ListItem href="#administration/users/all">Users</ListItem>
        <ListItem href="#administration/patronages">Patronages</ListItem>
        <ListItem href="#administration/patronagescsv">Patronages CSV</ListItem>
        <ListItem href="#administration/descriptions">Descriptions</ListItem>
        <ListItem href="#administration/bnsctdbs_kith_rules">Kith Rules</ListItem>
        <ListItem href="#administration/bnsmetv1_clan_rules">Clan Rules</ListItem>
        <ListItem href="#administration/bnsmetv1_elder_discipline_rules">
          Elder Discipline Rules
        </ListItem>
        <ListItem href="#administration/bnsmetv1_technique_rules">Technique Rules</ListItem>
        <ListItem href="#administration/bnsmetv1_ritual_rules">Ritual Rules</ListItem>
        <ListItem href="#administration/referendums">Referendums</ListItem>
      </Listview>
    </Page>
  );
}

registerScreen('administration', AdministrationScreen);
