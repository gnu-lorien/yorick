import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';

import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { Fragment, useEffect } from 'react';
import type { Character } from '@/parse/models/Character';
import type { Venue } from '@/parse/venues/types';
import { loadCharacter } from '@/parse/character/load';
import { isBeingCreated } from '@/parse/character/creation';
import { experienceAvailable } from '@/parse/character/experience';
import { CharacterSummary } from './CharacterSummary';
import { navigate } from '@/router/router';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The character sheet -- the screen everything else hangs off.
 *
 * Ports `show_character_helper` in mobileRouter.js:851, views/CharacterView.js
 * and the `#characterView` template in public/index.html.
 *
 * Three routes render it, differing only in where Back goes:
 *
 *   character                 back to #characters?all
 *   troupe_character          back to #troupe/<id>/characters/all
 *   administration_character  back to #administration/characters/all
 *
 * That is the whole of the difference, which is why the legacy code funnels all
 * three through one helper taking `back_url` -- and why this takes the back
 * target from the route rather than having three screens.
 *
 * The page is a long list of links, arranged in `ui-grid-b` rows of three. The
 * only parts that vary are the trait categories -- which come from the venue,
 * grouped under a heading that changes as the list walks it -- and the
 * information block, which is hidden while the character is still in creation.
 *
 * @compare #character?9cYrGGv2w3
 *
 * Only one character is compared, and deliberately. The legacy sheet's identity
 * wrapper keeps the objectId of whichever character was opened FIRST in that
 * page's life (see CharacterSummary), so comparing a second one reports that
 * stale id and nothing else. All three creature types were checked by hand and
 * agree line for line -- 219 lines for the vampire, 204 for the werewolf, 191
 * for the changeling -- with that single wrapper id the only difference.
 */
export function CharacterSheet({ route }: ScreenProps) {
  // `character?:id` puts the id in a named slot, not the query string: the "?"
  // in that pattern is literal. See router/backboneRoutes.ts.
  const id = route.named['id'] ?? route.named['cid'] ?? '';
  const backUrl = backUrlFor(route);
  useBackButton(backUrl);

  const { show, hide } = useLoading();
  const { data, error, isFetching } = useQuery({
    queryKey: ['character', id],
    enabled: !!id,
    queryFn: () => loadCharacter(id),
  });

  // The legacy handler wraps the whole route in $.mobile.loading("show") and
  // drops it in a `.then` that runs either way. Driven here by the query's own
  // in-flight flag, so there is no pair to keep matched.
  useEffect(() => {
    if (!isFetching) return;
    show();
    return hide;
  }, [isFetching, show, hide]);

  // The legacy tail is `.fail(PromiseFailReport).fail(function () {
  // window.location.hash = back_url; })` -- it reports and then sends the user
  // back where they came from, rather than leaving them on a blank sheet.
  useEffect(() => {
    if (!error) return;
    showError(error, "Couldn't open that character");
    navigate(backUrl);
  }, [error, backUrl]);

  if (!data) return <Page id="character" title="Character" />;
  return <Sheet character={data.character} venue={data.venue} />;
}

/** Where Back goes, which is the only thing the three routes disagree on. */
function backUrlFor(route: ScreenProps['route']): string {
  switch (route.entry.handler) {
    case 'troupe_character':
      return `#troupe/${route.named['id']}/characters/all`;
    case 'administration_character':
      return '#administration/characters/all';
    default:
      return '#characters?all';
  }
}

function Sheet({ character, venue }: { character: Character; venue: Venue }) {
  const id = character.id ?? '';
  const creating = isBeingCreated(character);

  return (
    <Page id="character" title="Character">
      <div id="insertheader">
        <CharacterSummary character={character} />
      </div>
      <div>
        Earned XP: {String(character.get('experience_earned') ?? '')}
        <br />
        Spent XP: {String(character.get('experience_spent') ?? '')}
        <br />
        Available XP: {experienceAvailable(character)}
        <br />
      </div>

      <div className="ui-grid-b ui-responsive">
        <LinkBlock first href={`#character/${id}/print`}>
          Show Latest
        </LinkBlock>
        <LinkBlock href={`#character/${id}/approved`}>Show Approved</LinkBlock>
        <LinkBlock href={`#character/${id}/approval`}>Show Approval</LinkBlock>
        <LinkBlock href={`#character/${id}/portrait`}>Character Portrait</LinkBlock>
        {/* "Print Latest" and "Print Approved" go to the same two URLs as the
            "Show" pair above them. That is what the template does; the printable
            sheet is the same page whether you mean to read it or print it. */}
        <LinkBlock href={`#character/${id}/print`}>Print Latest</LinkBlock>
        <LinkBlock href={`#character/${id}/approved`}>Print Approved</LinkBlock>
        <LinkBlock href={`#character/${id}/rename`}>Rename</LinkBlock>
        <LinkBlock href={`#character/${id}/extendedprinttext`}>Extended Print Text</LinkBlock>
        <LinkBlock href={`#character/${id}/backgroundlt`}>Background</LinkBlock>
        <LinkBlock href={`#character/${id}/noteslt`}>Notes</LinkBlock>
      </div>

      {creating ? (
        <ul
          data-role="listview"
          data-inset="true"
          className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
        >
          <li className="ui-first-child ui-last-child">
            <a href={`#charactercreate/${id}`} className="ui-btn ui-btn-icon-right ui-icon-carat-r">
              Character Creation
            </a>
          </li>
        </ul>
      ) : null}

      <div className="ui-grid-b ui-responsive">
        <TraitCategories character={character} venue={venue} />
        {!creating ? <InformationBlock character={character} venue={venue} /> : null}
      </div>

      <h3 className="ui-bar ui-bar-a">Progression</h3>
      <div className="ui-grid-b ui-responsive">
        <LinkBlock first href={`#character/${id}/history/0`}>
          History
        </LinkBlock>
        <LinkBlock href={`#character/${id}/experience/0/10`}>Experience Points</LinkBlock>
        <LinkBlock href={`#character/${id}/costs`}>Costs</LinkBlock>
        <LinkBlock href={`#character/${id}/log/0/10`}>Log</LinkBlock>
      </div>

      <h3 className="ui-bar ui-bar-a">Troupes</h3>
      <div className="ui-grid-b ui-responsive">
        <LinkBlock first href={`#character/${id}/troupes`}>
          Show My Troupes
        </LinkBlock>
        <LinkBlock href={`#character/${id}/troupes/join`}>Join Troupe</LinkBlock>
        <LinkBlock href={`#character/${id}/troupes/leave`}>Leave Troupe</LinkBlock>
      </div>

      <h3 className="ui-bar ui-bar-a">Final Death</h3>
      <div className="ui-grid-b ui-responsive">
        <LinkBlock first href={`#character/${id}/delete`}>
          Delete Character
        </LinkBlock>
      </div>
    </Page>
  );
}

/**
 * One cell of the link grid: a `ui-block` holding an inset listview of one row.
 *
 * A whole listview per link is not how anyone would write this from scratch,
 * but it is what the template does, and the inset listview is what gives each
 * link its rounded full-width button look.
 *
 * `first` marks the `ui-block-a` that opens a grid row. The template uses
 * `ui-block-a` only for the first cell of each `ui-grid-b` and `ui-block-b` for
 * every other cell -- including the fourth, fifth and sixth, where a correct
 * three-column grid would cycle a, b, c. Reproduced as written.
 */
function LinkBlock({
  href,
  children,
  first,
}: {
  href: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div className={first ? 'ui-block-a' : 'ui-block-b'}>
      <ul
        data-role="listview"
        data-inset="true"
        className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        <li className="ui-first-child ui-last-child">
          <a href={href} className="ui-btn ui-btn-icon-right ui-icon-carat-r">
            {children}
          </a>
        </li>
      </ul>
    </div>
  );
}

/**
 * The trait categories, with a heading bar whenever the group changes.
 *
 * The template tracks the previous group in a local and emits an `<h3>` only
 * when the current row's differs, so the categories must stay in their declared
 * order -- venues/data.ts preserves it for exactly this reason. Sorting them
 * would scatter each group's rows and print a heading above every one.
 */
function TraitCategories({ character, venue }: { character: Character; venue: Venue }) {
  const id = character.id ?? '';
  let heading: string | null = null;

  return (
    <>
      {venue.data.categories.map((category) => {
        const newHeading = heading !== category.group ? category.group : null;
        heading = category.group;
        return (
          // A Fragment, not a wrapper div: the template emits the heading and
          // the block as siblings of the surrounding grid, and any element
          // around them would sit between `ui-grid-b` and its `ui-block-*`
          // children, which is exactly the relationship the grid CSS keys on.
          <Fragment key={category.key}>
            {newHeading ? <h3 className="ui-bar ui-bar-a">{newHeading}</h3> : null}
            <div className="ui-block-b">
              <ul
                data-role="listview"
                data-inset="true"
                className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
              >
                <li className="ui-first-child ui-last-child">
                  <a
                    href={`#simpletraits/${category.key}/${id}/all`}
                    className="ui-btn ui-btn-icon-right ui-icon-carat-r"
                  >
                    {category.prettyName}
                  </a>
                </li>
              </ul>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * The free-text fields -- clan, archetype, sect and the venue's rest.
 *
 * A field that is set shows its value in a divider, then Repick and Unpick; a
 * field that is not shows only Pick. The URLs pluralise the attribute name for
 * the category segment -- `#simpletext/clans/clan/<id>/pick` -- which is what
 * `simpletext/:category/:target/:cid/pick` expects.
 *
 * Hidden entirely while the character is in creation, because the creation
 * wizard owns these fields until it finishes.
 */
function InformationBlock({ character, venue }: { character: Character; venue: Venue }) {
  const id = character.id ?? '';
  return (
    <>
      <h3 className="ui-bar ui-bar-a">Information</h3>
      <div className="ui-grid-b ui-responsive">
        {venue.data.textAttributes.map((attribute) => {
          const key = attribute.key;
          // The template capitalises the attribute NAME, not the venue's pretty
          // label -- `st[0].toUpperCase() + st.substr(1)` -- so "ctdbs_kith"
          // shows as "Ctdbs_kith" rather than "Kith". Reproduced.
          const shown = key.charAt(0).toUpperCase() + key.slice(1);
          const value = character.get(key) as string | undefined;
          return (
            <div className="ui-block-b" key={key}>
              <ul
                data-role="listview"
                data-inset="true"
                className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
              >
                {value ? (
                  <>
                    <li
                      data-role="list-divider"
                      role="heading"
                      className="ui-li-divider ui-bar-inherit ui-first-child"
                    >
                      {shown}
                      <p>{value}</p>
                    </li>
                    <li>
                      <a
                        href={`#simpletext/${key}s/${key}/${id}/pick`}
                        className="ui-btn ui-btn-icon-right ui-icon-carat-r"
                      >
                        Repick {shown}
                      </a>
                    </li>
                    <li data-icon="delete" className="ui-last-child">
                      <a
                        href={`#simpletext/${key}s/${key}/${id}/unpick`}
                        className="ui-btn ui-btn-icon-right ui-icon-delete"
                      >
                        Unpick {shown}
                      </a>
                    </li>
                  </>
                ) : (
                  <li className="ui-first-child ui-last-child">
                    <a
                      href={`#simpletext/${key}s/${key}/${id}/pick`}
                      className="ui-btn ui-btn-icon-right ui-icon-carat-r"
                    >
                      Pick {shown}
                    </a>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}

registerScreen('character', CharacterSheet);
registerScreen('troupe_character', CharacterSheet);
registerScreen('administration_character', CharacterSheet);


