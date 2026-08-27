import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/jqm/Page';
import { cx } from '@/jqm/classes';
import { useLoading } from '@/jqm/Loader';
import { useBackButton } from '@/shell/backButton';
import { showError } from '@/shell/reportError';
import { navigate } from '@/router/router';
import { Parse } from '@/parse/init';
import { Character, sortCharacters } from '@/parse/models/Character';
import { Troupe } from '@/parse/models/Troupe';
import { hydratePointers } from '@/parse/users';
import { useSession } from '@/parse/session';
import { CharacterListItem } from './CharacterListItem';
import { registerScreen, type ScreenProps } from './registry';

/**
 * The two character rosters that are not a player's own.
 *
 * `administration_characters_all` lists every character in the system on
 * `#characters-all`; `troupecharacters` lists one troupe's on
 * `#troupe-characters-all`. They differ in what they query, where a row links
 * to, and which page they render into -- and share everything else, including
 * the filter box and the row markup.
 *
 * Neither query includes the owner, and that is deliberate in both.
 * parse-server deletes an unreadable pointer only when asked to *expand* it, so
 * including `owner` made a private owner's character arrive with the key
 * missing outright. On the troupe roster that was worse than a blank name: the
 * `has("owner")` test below reads a missing owner as archived, so those
 * characters silently vanished from the list. The names are filled in
 * afterwards by `hydratePointers`.
 *
 * @compare #administration/characters/all
 */
export function AdministrationCharacters(_: ScreenProps) {
  const session = useSession();
  useBackButton('#administration');

  const { show, hide } = useLoading();
  const blocked = session.loggedIn && !session.admin;

  useEffect(() => {
    if (!blocked) return;
    showError('Couldn’t list every character', "Couldn't list every character");
    navigate('');
  }, [blocked]);

  const { data, isFetching, error } = useQuery({
    queryKey: ['administration-characters'],
    enabled: !blocked,
    queryFn: async () => {
      const found: Character[] = [];
      // Two queries, not one, and in this order -- werewolves first, then
      // everything else. `get_administrator_characters` splits them because
      // the legacy venue models are separate constructors over one className;
      // here it changes nothing but the order rows arrive in, and the list is
      // sorted afterwards anyway. Kept so the two front ends issue the same
      // requests.
      const werewolves = new Parse.Query(Character)
        .exists('owner')
        .include('portrait')
        .equalTo('type', 'Werewolf');
      await werewolves.each((character) => {
        found.push(character);
      });

      const rest = new Parse.Query(Character)
        .exists('owner')
        .include('portrait')
        .notEqualTo('type', 'Werewolf');
      await rest.each((character) => {
        found.push(character);
      });

      await hydratePointers(found, 'owner');
      return found;
    },
  });

  useSpinner(isFetching, show, hide);
  useEffect(() => {
    if (error) showError(error, "Couldn't list every character");
  }, [error]);

  if (blocked) return null;

  return (
    <CharacterRoster
      pageId="characters-all"
      title="Characters"
      filterId="characters-filter"
      characters={data ?? []}
      href={(id) => `#administration/character/${id}`}
      addNewLink
    />
  );
}

/**
 * One troupe's characters.
 *
 * A character with no owner is *archived* and is left out, which is what
 * `options.includedeleted` defaults to. Nothing in the routes passes it, so the
 * archived branch is unreachable from the UI today.
 *
 * @compare #troupe/qvtD2RxzGG/characters/all
 */
export function TroupeCharacters({ route }: ScreenProps) {
  const id = route.named['id'] ?? '';
  const type = route.named['type'];
  useBackButton(`#troupe/${id}`);

  const { show, hide } = useLoading();
  const { data, isFetching, error } = useQuery({
    queryKey: ['troupe-characters', id],
    enabled: !!id,
    queryFn: async () => {
      const troupe = await new Parse.Query(Troupe).include('portrait').get(id);
      const found: Character[] = [];
      await new Parse.Query(Character)
        .equalTo('troupes', troupe)
        .include('portrait')
        .each((character) => {
          // No owner means archived. See the note on the screen above for why
          // this test only means what it says because `owner` is not included.
          if (character.has('owner')) found.push(character);
        });
      await hydratePointers(found, 'owner');
      return found;
    },
  });

  useSpinner(isFetching, show, hide);
  useEffect(() => {
    if (error) showError(error, "Couldn't list that troupe's characters");
  }, [error]);

  // The route takes a `:type` and the handler ignores it -- there is no branch
  // on it at all, unlike `characters`, which checks for "all". Any value lists
  // the troupe.
  void type;

  return (
    <CharacterRoster
      pageId="troupe-characters-all"
      title="Troupe Characters"
      filterId="troupes-characters-filter"
      characters={data ?? []}
      href={(cid) => `#troupe/${id}/character/${cid}`}
    />
  );
}

function useSpinner(active: boolean, show: () => void, hide: () => void) {
  useEffect(() => {
    if (!active) return;
    show();
    return hide;
  }, [active, show, hide]);
}

/**
 * The shared roster: a filter box above a listview of character rows.
 *
 * `#characters-all` also carries an "Add New Character" list above the filter,
 * because it is the same page the player's own roster renders into. The troupe
 * page has no such list.
 */
function CharacterRoster({
  pageId,
  title,
  filterId,
  characters,
  href,
  addNewLink,
}: {
  pageId: string;
  title: string;
  filterId: string;
  characters: Character[];
  href: (id: string) => string;
  addNewLink?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const sorted = useMemo(() => sortCharacters(characters), [characters]);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((character) => rowText(character).toLowerCase().includes(needle));
  }, [sorted, filter]);

  return (
    <Page id={pageId} title={title}>
      {addNewLink ? (
        <ul>
          <li>
            <a href="#characternew">Add New Character</a>
          </li>
        </ul>
      ) : null}
      <form className="ui-filterable" onSubmit={(e) => e.preventDefault()}>
        <div className="ui-input-search ui-body-inherit ui-corner-all ui-shadow-inset ui-input-has-clear">
          <input
            id={filterId}
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
        data-inset="true"
        data-filter="true"
        data-input={`#${filterId}`}
        className="ui-listview ui-listview-inset ui-corner-all ui-shadow"
      >
        {visible.map((character, i) => (
          <CharacterListItem
            key={character.id}
            character={character}
            href={href}
            index={i}
            total={visible.length}
          />
        ))}
      </ul>
    </Page>
  );
}

/** Everything a row displays, for the filter to match against. */
function rowText(character: Character): string {
  const owner = character.owner;
  return [
    character.name,
    character.get('sect'),
    character.get('archetype'),
    character.get('clan'),
    character.get('antecedence'),
    character.get('faction'),
    character.get('title'),
    character.get('wta_tribe'),
    character.get('wta_breed'),
    character.get('wta_auspice'),
    character.get('wta_faction'),
    character.get('wta_camp'),
    character.get('ctdbs_kith'),
    character.get('ctdbs_fealty_court'),
    character.get('ctdbs_kith_group_type'),
    character.get('ctdbs_noble_house'),
    owner?.get('realname'),
    owner?.get('email'),
    owner?.get('username'),
    character.status(),
  ]
    .filter(Boolean)
    .join(' ');
}

registerScreen('administration_characters_all', AdministrationCharacters);
registerScreen('troupecharacters', TroupeCharacters);
